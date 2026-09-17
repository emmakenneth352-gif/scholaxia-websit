import 'dart:io';
import 'dart:typed_data';

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
      _player.onPlayerComplete.listen((_) => _setSpeaking(false));
    } catch (e) {
      debugPrint('SiaVoice init warning: $e');
    }
    _ready = true;
  }

  String cleanForSpeech(String text) {
    var t = text;
    t = t.replaceAll(RegExp(r'```[\s\S]*?```'), ' ');
    t = t.replaceAll(RegExp(r'`([^`]+)`'), r'$1');
    t = t.replaceAll(RegExp(r'\*\*([^*]+)\*\*'), r'$1');
    t = t.replaceAll(RegExp(r'\*([^*]+)\*'), r'$1');
    t = t.replaceAll(RegExp(r'^#+\s*', multiLine: true), '');
    t = t.replaceAll(RegExp(r'\s+'), ' ').trim();
    if (t.length > 1400) t = '${t.substring(0, 1400).trim()}...';
    return t;
  }

  Future<void> speak(String text, {String language = 'english'}) async {
    final cleaned = cleanForSpeech(text);
    if (cleaned.isEmpty) return;
    var started = false;
    try {
      await init();
      await stop();
      _setSpeaking(true);

      // Windows: SAPI is fast and needs no extra packages
      if (!kIsWeb && Platform.isWindows) {
        final ok = await _speakWindowsSapi(cleaned);
        if (ok) { started = true; return; }
      }

      // Cloud TTS (works on all platforms)
      try {
        final bytes = await ApiService().fetchVoiceAudio(cleaned, language: language);
        if (bytes != null && bytes.isNotEmpty) {
          final ok = await _playMp3Bytes(bytes);
          if (ok) { started = true; return; }
        }
      } catch (e) {
        debugPrint('SiaVoice cloud TTS failed: $e');
      }
    } catch (e) {
      debugPrint('SiaVoice speak failed: $e');
    } finally {
      if (!started) _setSpeaking(false);
    }
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
        "\$s.Rate = -1",
        "\$s.SetOutputToWaveFile('$safePath')",
        "\$s.Speak('$safe')",
        "\$s.Dispose()",
      ].join('; ');
      final result = await Process.run('powershell', ['-NoProfile', '-NonInteractive', '-Command', script]);
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

  Future<void> stop() async {
    _setSpeaking(false);
    try { await _player.stop(); } catch (_) {}
  }
}
