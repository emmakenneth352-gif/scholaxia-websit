import 'dart:async';

import 'package:flutter/material.dart';

import '../../../api/api_service.dart';
import '../../../services/cbt_offline_store.dart';
import '../../../theme/app_theme.dart';
import 'cbt_result_screen.dart';

/// Runs a board practice attempt (JAMB / WAEC / NECO).
/// - Subject tabs like the desktop app; each subject loads ONLY its own board bank.
/// - First online load caches every opened subject for offline use.
/// - Offline: cached subjects play and score locally; new questions sync when
///   the device is back online (auto-refresh on start).
class CbtPracticeRunnerScreen extends StatefulWidget {
  const CbtPracticeRunnerScreen({
    super.key,
    required this.attempt,
    required this.board,
  });

  final Map<String, dynamic> attempt;
  final String board;

  @override
  State<CbtPracticeRunnerScreen> createState() =>
      _CbtPracticeRunnerScreenState();
}

class _SectionQ {
  final String id;
  final String text;
  final List<String> options;
  final String? topic;
  final String? imageUrl;
  final String? correctKey; // kept locally for offline scoring only

  const _SectionQ({
    required this.id,
    required this.text,
    required this.options,
    this.topic,
    this.imageUrl,
    this.correctKey,
  });

  factory _SectionQ.from(Map q) {
    final opts = (q['options'] as List?) ?? const [];
    return _SectionQ(
      id: q['id']?.toString() ?? '',
      text: q['question_text']?.toString() ?? '',
      options: opts.map((o) {
        if (o is Map) return o['text']?.toString() ?? '';
        return o.toString();
      }).where((s) => s.isNotEmpty).toList(),
      topic: q['topic']?.toString(),
      imageUrl: q['image_url']?.toString(),
      correctKey: q['correct_key']?.toString(),
    );
  }

  Map<String, dynamic> toCacheJson() => {
        'id': id,
        'question_text': text,
        'options': [
          for (var i = 0; i < options.length; i++)
            {'key': 'ABCDEF'[i], 'text': options[i]}
        ],
        'topic': topic,
        'image_url': imageUrl,
        'correct_key': correctKey,
      };
}

class _CbtPracticeRunnerScreenState extends State<CbtPracticeRunnerScreen> {
  final _api = ApiService();
  final _store = CbtOfflineStore.instance;

  late final String _attemptId;
  late final List<String> _subjects;
  late int _secondsLeft;
  Timer? _timer;

  int _section = 0;
  bool _loadingSection = false;
  String? _sectionError;
  bool _offline = false;

  List<_SectionQ> _questions = [];
  final Map<String, String> _answers = {}; // qid -> A/B/C/D
  int _current = 0; // 0-based
  bool _submitting = false;

  String get _cacheKey => 'attempt:$_attemptId:$_section';

  @override
  void initState() {
    super.initState();
    final a = widget.attempt;
    _attemptId = a['attempt_id']?.toString() ?? '';
    _subjects = ((a['subjects'] as List?) ?? const [])
        .map((e) => e.toString())
        .toList();
    final left = (a['seconds_left'] as num?)?.toInt();
    final dur = (a['duration_minutes'] as num?)?.toInt() ?? 60;
    _secondsLeft = (left == null || left <= 0) ? dur * 60 : left;
    _restoreLocalAnswers();
    _startTimer();
    _openSection(0);
  }

  @override
  void dispose() {
    _timer?.cancel();
    super.dispose();
  }

  void _startTimer() {
    _timer = Timer.periodic(const Duration(seconds: 1), (_) {
      if (!mounted) return;
      if (_secondsLeft > 0) {
        setState(() => _secondsLeft--);
      } else {
        _timer?.cancel();
        _submit(auto: true);
      }
    });
  }

  Future<void> _restoreLocalAnswers() async {
    final cached = await _store.loadPack('attempt:$_attemptId:answers');
    if (cached != null && cached['answers'] is Map) {
      final map = (cached['answers'] as Map).map(
        (k, v) => MapEntry(k.toString(), v.toString()),
      );
      if (mounted) setState(() => _answers.addAll(map));
    }
  }

  Future<void> _persistAnswersLocally() async {
    await _store.savePack('attempt:$_attemptId:answers', {'answers': _answers});
  }

  /// Load the active subject section: cache-first, then network (auto-sync).
  Future<void> _openSection(int index, {bool forceOnline = false}) async {
    if (index < 0 || index >= _subjects.length) return;
    setState(() {
      _section = index;
      _sectionError = null;
    });

    final cached = await _store.loadPack(_cacheKey);
    if (cached != null && (cached['questions'] as List?)?.isNotEmpty == true) {
      _applySection(cached, fromCache: true);
      if (!forceOnline) return;
    }

    if (forceOnline) setState(() => _loadingSection = true);
    try {
      final sec = await _api.cbtPracticeSection(_attemptId, index);
      await _store.savePack(_cacheKey, Map<String, dynamic>.from(sec));
      if (!mounted) return;
      setState(() {
        _offline = false;
        _loadingSection = false;
      });
      _applySection(sec, fromCache: false);
    } catch (e) {
      if (!mounted) return;
      if (cached != null) {
        // Network failed but we have the cached subject — play offline.
        setState(() {
          _loadingSection = false;
          _offline = true;
        });
        return;
      }
      setState(() {
        _loadingSection = false;
        _sectionError = e.toString();
      });
    }
  }

  void _applySection(Map<String, dynamic> sec, {required bool fromCache}) {
    final qs = ((sec['questions'] as List?) ?? const [])
        .whereType<Map>()
        .map(_SectionQ.from)
        .toList();
    // Fresh questions from the server may add new items — sync = replace.
    setState(() {
      _questions = qs;
      _current = 0;
      _offline = fromCache ? _offline : false;
    });
  }

  void _pick(int optionIndex) {
    if (_questions.isEmpty) return;
    final q = _questions[_current];
    const labels = 'ABCDEF';
    if (optionIndex < 0 || optionIndex >= labels.length) return;
    setState(() {
      if (_answers[q.id] == labels[optionIndex]) {
        _answers.remove(q.id); // tap again to clear
      } else {
        _answers[q.id] = labels[optionIndex];
      }
    });
    _persistAnswersLocally();
    _saveOnline();
  }

  Future<void> _saveOnline() async {
    if (_offline || _attemptId.isEmpty) return;
    try {
      await _api.cbtPracticeSaveAnswers(_attemptId, _answers, sectionIndex: _section);
    } catch (_) {
      // Silent — answers also live locally and submit retries.
    }
  }

  Future<void> _submit({bool auto = false}) async {
    if (_submitting) return;
    _timer?.cancel();
    setState(() => _submitting = true);

    // Try server scoring first (authoritative + saves history).
    if (!_offline && _attemptId.isNotEmpty) {
      try {
        final res = await _api.cbtPracticeSubmit(_attemptId, _answers);
        if (!mounted) return;
        final score = (res['score'] as num?)?.toDouble() ?? 0;
        final max = (res['max_score'] as num?)?.toDouble() ?? 0;
        final pct = max > 0 ? score / max * 100 : 0.0;
        final wrong = (res['wrong_count'] as num?)?.toInt() ?? 0;
        await _store.deletePack('attempt:$_attemptId:answers');
        Navigator.pushReplacement(
          context,
          MaterialPageRoute(
            builder: (_) => CbtResultScreen(
              sessionId: '',
              result: CbtResult(
                score: score,
                percentage: pct,
                totalCorrect: score.toInt(),
                totalWrong: wrong,
              ),
            ),
          ),
        );
        return;
      } catch (_) {
        // fall through to local scoring (offline or server hiccup)
      }
    }

    // Local scoring from the cached key.
    var correct = 0;
    var total = 0;
    final weak = <String>{};
    for (final q in _questions) {
      total++;
      final ans = _answers[q.id];
      if (q.correctKey != null && ans == q.correctKey) {
        correct++;
      } else {
        final t = q.topic?.trim();
        if (t != null && t.isNotEmpty) weak.add(t);
      }
    }
    final pct = total > 0 ? correct / total * 100 : 0.0;
    if (!mounted) return;
    Navigator.pushReplacement(
      context,
      MaterialPageRoute(
        builder: (_) => CbtResultScreen(
          sessionId: '',
          result: CbtResult(
            score: correct.toDouble(),
            percentage: pct,
            totalCorrect: correct,
            totalWrong: total - correct < 0 ? 0 : total - correct,
            weakTopics: weak.toList(),
          ),
        ),
      ),
    );
  }

  String get _timerDisplay {
    final m = (_secondsLeft ~/ 60).toString().padLeft(2, '0');
    final s = (_secondsLeft % 60).toString().padLeft(2, '0');
    return '$m:$s';
  }

  @override
  Widget build(BuildContext context) {
    final accent = context.accentColor;
    return PopScope(
      canPop: !_submitting,
      child: Scaffold(
        backgroundColor: context.bgColor,
        appBar: AppBar(
          backgroundColor: context.cardColor,
          elevation: 0,
          title: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Text('${widget.board} CBT',
                style: const TextStyle(fontSize: 15, fontWeight: FontWeight.w800)),
            Text(
              '$_timerDisplay · ${_answers.length} answered',
              style: TextStyle(
                  fontSize: 11,
                  color: _secondsLeft < 300 ? const Color(0xFFEF4444) : context.greyColor),
            ),
          ]),
          actions: [
            if (_offline)
              const Padding(
                padding: EdgeInsets.only(right: 10),
                child: Center(
                  child: Icon(Icons.cloud_off_rounded, size: 18, color: Color(0xFFF59E0B)),
                ),
              ),
          ],
        ),
        body: Column(children: [
          _subjectTabs(accent),
          Expanded(child: _body(accent)),
          _bottomBar(accent),
        ]),
      ),
    );
  }

  Widget _subjectTabs(Color accent) {
    return Container(
      height: 46,
      color: context.cardColor,
      child: ListView.builder(
        scrollDirection: Axis.horizontal,
        padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 6),
        itemCount: _subjects.length,
        itemBuilder: (_, i) {
          final on = i == _section;
          return Padding(
            padding: const EdgeInsets.only(right: 8),
            child: ChoiceChip(
              selected: on,
              onSelected: (_) => _openSection(i),
              label: Text(_subjects[i]),
              labelStyle: TextStyle(
                fontSize: 12,
                fontWeight: on ? FontWeight.w800 : FontWeight.w500,
                color: on ? Colors.white : context.textColor,
              ),
              selectedColor: accent,
              showCheckmark: false,
            ),
          );
        },
      ),
    );
  }

  Widget _body(Color accent) {
    if (_loadingSection) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_sectionError != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(mainAxisSize: MainAxisSize.min, children: [
            const Icon(Icons.wifi_off_rounded, size: 40, color: Color(0xFFF59E0B)),
            const SizedBox(height: 10),
            Text(
              'This subject needs one online load before it works offline.\n$_sectionError',
              textAlign: TextAlign.center,
              style: TextStyle(color: context.greyColor, fontSize: 13, height: 1.4),
            ),
            const SizedBox(height: 12),
            FilledButton(
              onPressed: () => _openSection(_section, forceOnline: true),
              child: const Text('Try again'),
            ),
          ]),
        ),
      );
    }
    if (_questions.isEmpty) {
      return Center(child: Text('No questions for this subject.',
          style: TextStyle(color: context.greyColor)));
    }
    final q = _questions[_current];
    final labels = 'ABCDEF';
    return RefreshIndicator(
      onRefresh: () => _openSection(_section, forceOnline: true),
      child: ListView(
        padding: const EdgeInsets.all(16),
        children: [
          Row(children: [
            Container(
              padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 4),
              decoration: BoxDecoration(
                color: accent.withOpacity(0.12),
                borderRadius: BorderRadius.circular(8),
              ),
              child: Text(
                'Question ${_current + 1} of ${_questions.length}',
                style: TextStyle(color: accent, fontWeight: FontWeight.w800, fontSize: 12),
              ),
            ),
            const Spacer(),
            if (_offline)
              Text('offline mode', style: TextStyle(color: context.greyColor, fontSize: 11)),
          ]),
          const SizedBox(height: 14),
          Text(q.text,
              style: TextStyle(
                  color: context.textColor, fontSize: 16, height: 1.45, fontWeight: FontWeight.w600)),
          const SizedBox(height: 18),
          for (var i = 0; i < q.options.length; i++) ...[
            _optionTile(q, i, labels[i], accent),
            const SizedBox(height: 10),
          ],
        ],
      ),
    );
  }

  Widget _optionTile(_SectionQ q, int i, String label, Color accent) {
    final selected = _answers[q.id] == label;
    return InkWell(
      borderRadius: BorderRadius.circular(14),
      onTap: () => _pick(i),
      child: Container(
        padding: const EdgeInsets.all(14),
        decoration: BoxDecoration(
          color: selected ? accent.withOpacity(0.12) : context.cardColor,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(
            color: selected ? accent : context.borderColor,
            width: selected ? 1.6 : 1,
          ),
        ),
        child: Row(children: [
          Container(
            width: 30,
            height: 30,
            alignment: Alignment.center,
            decoration: BoxDecoration(
              shape: BoxShape.circle,
              color: selected ? accent : Colors.transparent,
              border: Border.all(color: selected ? accent : context.borderColor),
            ),
            child: Text(label,
                style: TextStyle(
                  fontWeight: FontWeight.w800,
                  color: selected ? Colors.white : context.textColor,
                )),
          ),
          const SizedBox(width: 12),
          Expanded(
            child: Text(q.options[i],
                style: TextStyle(color: context.textColor, fontSize: 14, height: 1.35)),
          ),
        ]),
      ),
    );
  }

  Widget _bottomBar(Color accent) {
    return Container(
      padding: EdgeInsets.fromLTRB(16, 10, 16, 10 + MediaQuery.of(context).padding.bottom * 0.3),
      decoration: BoxDecoration(
        color: context.cardColor,
        border: Border(top: BorderSide(color: context.borderColor)),
      ),
      child: Row(children: [
        OutlinedButton(
          onPressed: _current > 0 ? () => setState(() => _current--) : null,
          child: const Icon(Icons.chevron_left),
        ),
        const SizedBox(width: 10),
        Expanded(
          child: OutlinedButton(
            onPressed: _current < _questions.length - 1
                ? () => setState(() => _current++)
                : null,
            child: const Icon(Icons.chevron_right),
          ),
        ),
        const SizedBox(width: 10),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: accent),
          onPressed: _submitting ? null : _submit,
          child: _submitting
              ? const SizedBox(
                  width: 18, height: 18,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
              : const Text('Submit'),
        ),
      ]),
    );
  }
}
