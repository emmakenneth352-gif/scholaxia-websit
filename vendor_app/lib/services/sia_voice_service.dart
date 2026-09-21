import 'dart:async';
import 'dart:io';

import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:path_provider/path_provider.dart';

import '../api/api_service.dart';

/// Speaks Sia / Teacher AI / Kind replies / kids games.
/// Uses cloud MP3 on all platforms + Windows SAPI as local fallback.
/// flutter_tts removed (requires nuget on Windows; was disabled anyway).
class SiaVoiceService {
  SiaVoiceService._();
  static final instance = SiaVoiceService._();

  final _player = AudioPlayer();
  bool _ready = false;
  bool _speaking = false;
  // Completer for the audio CURRENTLY playing (completed = audio really done).
  Completer<void>? _playDone;
  // Queue so overlapping speak() calls play one after another (never cut off).
  Future<void> _queue = Future.value();
  void Function(bool speaking)? onSpeakingChanged;

  bool get isSpeaking => _speaking;

  void _setSpeaking(bool value) {
    if (_speaking == value) return;
    _speaking = value;
    try {
      onSpeakingChanged?.call(value);
    } catch (e) {
      debugPrint('SiaVoice speaking callback error: $e');
    }
  }

  Future<void> init() async {
    if (_ready) return;
    try {
      await _player.setReleaseMode(ReleaseMode.stop);
      _player.onPlayerComplete.listen((_) => _finishPlay());
    } catch (e) {
      debugPrint('SiaVoice init warning: $e');
    }
    _ready = true;
  }

  void _finishPlay() {
    final c = _playDone;
    _playDone = null;
    if (c != null && !c.isCompleted) c.complete();
  }

  String cleanForSpeech(String text) {
    var t = text;
    t = t.replaceAll(RegExp(r'```[\s\S]*?```'), ' ');
    // Dart's replaceAll does NOT expand "$1" (that's JavaScript) — use
    // replaceAllMapped or the literal "$1" lands in the spoken text.
    t = t.replaceAllMapped(RegExp(r'`([^`]+)`'), (m) => m.group(1)!);
    t = t.replaceAllMapped(RegExp(r'\*\*([^*]+)\*\*'), (m) => m.group(1)!);
    t = t.replaceAllMapped(RegExp(r'\*([^*]+)\*'), (m) => m.group(1)!);
    t = t.replaceAll(RegExp(r'^#+\s*', multiLine: true), '');
    t = t.replaceAll(RegExp(r'\s+'), ' ').trim();
    if (t.length > 1400) t = '${t.substring(0, 1400).trim()}...';
    return t;
  }

  /// Split long text into sentence-sized phrases so each TTS request is small
  /// and starts fast (long single requests are the main cause of broken audio).
  List<String> _splitPhrases(String text) {
    final clean = cleanForSpeech(text);
    if (clean.length <= 260) return [clean];
    final parts = <String>[];
    final sentences =
        clean.split(RegExp(r'(?<=[.!?…:;])\s+')).where((s) => s.trim().isNotEmpty);
    var buf = '';
    for (final s in sentences) {
      if (buf.length + s.length + 1 > 260 && buf.isNotEmpty) {
        parts.add(buf.trim());
        buf = s;
      } else {
        buf = buf.isEmpty ? s : '$buf $s';
      }
    }
    if (buf.trim().isNotEmpty) parts.add(buf.trim());
    return parts.isEmpty ? [clean] : parts;
  }

  /// Speaks the whole text. Returns when the audio has ACTUALLY finished
  /// playing (or failed). Concurrent calls are queued, never cut each other.
  Future<void> speak(String text, {String language = 'english'}) async {
    final cleaned = cleanForSpeech(text);
    if (cleaned.isEmpty) return;
    // Chain onto the playback queue so a second call waits, not interrupts.
    final run = _queue.then((_) => _speakNow(cleaned, language: language));
    _queue = run.catchError((_) {});
    await run;
  }

  Future<void> _speakNow(String cleaned, {String language = 'english'}) async {
    await init();
    var started = false;
    try {
      _setSpeaking(true);
      final phrases = _splitPhrases(cleaned);
      for (final phrase in phrases) {
        if (phrase.trim().isEmpty) continue;
        final ok = await _speakOne(phrase, language: language);
        if (ok) started = true;
      }
    } catch (e) {
      debugPrint('SiaVoice speak failed: $e');
    } finally {
      _finishPlay();
      _playDone = null;
      if (!started) _setSpeaking(false);
    }
  }

  /// Speak one phrase, waiting for real playback completion.
  Future<bool> _speakOne(String phrase, {String language = 'english'}) async {
    await stopPlaybackOnly();
    final done = Completer<void>();
    _playDone = done;
    _setSpeaking(true);

    // Windows: SAPI is fast and needs no extra packages
    if (!kIsWeb && Platform.isWindows) {
      final ok = await _speakWindowsSapi(phrase);
      if (ok) {
        await done.future.timeout(const Duration(minutes: 3), onTimeout: () {});
        _playDone = null;
        return true;
      }
      // SAPI failed — fall through to cloud TTS below.
    }

    // Cloud TTS (works on all platforms)
    var cloudOk = false;
    try {
      final bytes =
          await ApiService().fetchVoiceAudio(phrase, language: language);
      if (bytes != null && bytes.isNotEmpty) {
        cloudOk = await _playMp3Bytes(bytes);
      }
    } catch (e) {
      debugPrint('SiaVoice cloud TTS failed: $e');
    }
    if (!cloudOk) {
      _finishPlay();
      return false;
    }
    // Wait until onPlayerComplete really fires (or a generous safety timeout).
    await done.future.timeout(const Duration(minutes: 3), onTimeout: () {});
    _playDone = null;
    return true;
  }

  Future<bool> _speakWindowsSapi(String text) async {
    try {
      final dir = await getTemporaryDirectory();
      final wavPath = '${dir.path}\\sia_${DateTime.now().millisecondsSinceEpoch}.wav';
      final safe = text.replaceAll("'", "''").replaceAll('\r', ' ').replaceAll('\n', ' ');
      final safePath = wavPath.replaceAll("'", "''");
      final script = [
        "Add-Type -AssemblyName System.Speech",
        "\$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
        "\$s.Rate = 0", // -1 was too fast/garbled for long sentences
        "\$s.SetOutputToWaveFile('$safePath')",
        "\$s.Speak('$safe')",
        "\$s.Dispose()",
      ].join('; ');
      final result = await Process.run(
          'powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
      if (result.exitCode != 0) return false;
      final file = File(wavPath);
      if (!await file.exists() || await file.length() == 0) return false;
      await _player.play(DeviceFileSource(wavPath));
      return true;
    } catch (e) {
      debugPrint('Windows SAPI failed: $e');
      return false;
    }
  }

  Future<bool> _playMp3Bytes(Uint8List bytes) async {
    try {
      if (!kIsWeb && (Platform.isWindows || Platform.isLinux)) {
        final dir = await getTemporaryDirectory();
        final file = File('${dir.path}/sia_${DateTime.now().millisecondsSinceEpoch}.mp3');
        await file.writeAsBytes(bytes, flush: true);
        await _player.play(DeviceFileSource(file.path));
      } else {
        await _player.play(BytesSource(bytes));
      }
      return true;
    } catch (e) {
      debugPrint('SiaVoice play failed: $e');
      return false;
    }
  }

  /// Internal: stop audio without touching the playback queue.
  Future<void> stopPlaybackOnly() async {
    try {
      await _player.stop();
    } catch (_) {}
  }

  /// Stop now: kills the current audio AND clears anything still queued.
  Future<void> stop() async {
    _playDone = null; // let any pending waiter time out instead of hanging
    _queue = Future.value(); // drop queued speech
    _setSpeaking(false);
    await stopPlaybackOnly();
  }
}
