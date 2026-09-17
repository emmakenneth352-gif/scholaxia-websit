import 'package:flutter/material.dart';
import '../../../api/api_service.dart';
import '../../../theme/app_theme.dart';
import '../../../utils/post_attachment_picker.dart';
import '../teacher_shared.dart';

class TeacherCbtScreen extends StatefulWidget {
  const TeacherCbtScreen({super.key});

  @override
  State<TeacherCbtScreen> createState() => _TeacherCbtScreenState();
}

class _TeacherCbtScreenState extends State<TeacherCbtScreen> {
  final _api = ApiService();
  String _selectedTab = 'My Tests';
  final _tabs = ['My Tests', 'Results', 'Create'];
  bool _loading = true;
  String? _teacherName;
  int _unread = 0;
  List<Map<String, dynamic>> _exams = [];
  Map<String, dynamic>? _selectedResults;
  bool _loadingResults = false;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() => _loading = true);
    try {
      final results = await Future.wait([
        _api.getTeacherMe(),
        _api.unreadNotificationCount(),
        _api.teacherSchoolExams(),
      ]);
      if (!mounted) return;
      setState(() {
        _teacherName = (results[0] as Map)['full_name']?.toString();
        _unread = results[1] as int;
        _exams = (results[2] as List)
            .whereType<Map>()
            .map((e) => Map<String, dynamic>.from(e))
            .toList();
        _loading = false;
      });
      teacherUnreadCount.value = results[1] as int;
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _loadResults(String examId) async {
    setState(() => _loadingResults = true);
    try {
      final data = await _api.schoolExamResults(examId);
      if (mounted) setState(() => _selectedResults = data);
    } on ApiException catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text(e.message), backgroundColor: Colors.red),
        );
      }
    } finally {
      if (mounted) setState(() => _loadingResults = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final accent = context.accentColor;
    return Scaffold(
      backgroundColor: context.bgColor,
      body: SafeArea(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const SizedBox(height: 16),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: TeacherTopBar(
                api: _api,
                teacherName: _teacherName,
                unreadCount: _unread,
                showBack: true,
              ),
            ),
            const SizedBox(height: 20),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Scholaxia Test',
                      style: TextStyle(
                          color: context.textColor,
                          fontSize: 22,
                          fontWeight: FontWeight.bold)),
                  const SizedBox(height: 4),
                  Text(
                      'Send your exams — manually or from PDF — then assign them to students.',
                      style: TextStyle(color: context.greyColor, fontSize: 13)),
                  const SizedBox(height: 16),
                  SingleChildScrollView(
                    scrollDirection: Axis.horizontal,
                    child: Row(
                      children: _tabs.map((t) {
                        final sel = t == _selectedTab;
                        return GestureDetector(
                          onTap: () => setState(() {
                            _selectedTab = t;
                            _selectedResults = null;
                          }),
                          child: Container(
                            margin: const EdgeInsets.only(right: 8),
                            padding: const EdgeInsets.symmetric(
                                horizontal: 18, vertical: 9),
                            decoration: BoxDecoration(
                              color: sel ? accent : context.surfColor,
                              borderRadius: BorderRadius.circular(20),
                            ),
                            child: Text(t,
                                style: TextStyle(
                                    color:
                                        sel ? Colors.black : context.greyLColor,
                                    fontSize: 13,
                                    fontWeight: sel
                                        ? FontWeight.bold
                                        : FontWeight.normal)),
                          ),
                        );
                      }).toList(),
                    ),
                  ),
                ],
              ),
            ),
            const SizedBox(height: 8),
            Expanded(
              child: _loading
                  ? Center(child: CircularProgressIndicator(color: accent))
                  : _selectedTab == 'My Tests'
                      ? _examList()
                      : _selectedTab == 'Create'
                          ? CreateExamTab(api: _api, onCreated: _load)
                          : _resultsView(),
            ),
          ],
        ),
      ),
    );
  }

  Widget _examList() {
    if (_exams.isEmpty) {
      return RefreshIndicator(
        color: context.accentColor,
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          children: [
            const SizedBox(height: 80),
            Center(
              child: Text('No tests yet — create one on the Create tab.',
                  style: TextStyle(color: context.greyColor),
                  textAlign: TextAlign.center),
            ),
          ],
        ),
      );
    }
    return RefreshIndicator(
      color: context.accentColor,
      onRefresh: _load,
      child: ListView.separated(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(20, 12, 20, 32),
        itemCount: _exams.length,
        separatorBuilder: (_, __) => const SizedBox(height: 12),
        itemBuilder: (_, i) {
          final e = _exams[i];
          final subject = e['subject']?.toString() ?? '';
          final color = TeacherUtils.subjectColor(subject, context);
          final start = e['scheduled_start']?.toString() ?? '';
          return Container(
            padding: const EdgeInsets.all(16),
            decoration: BoxDecoration(
              color: context.cardColor,
              borderRadius: BorderRadius.circular(14),
              border: Border.all(color: context.borderColor),
            ),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(e['title']?.toString() ?? 'Test',
                    style: TextStyle(
                        color: context.textColor,
                        fontSize: 15,
                        fontWeight: FontWeight.bold)),
                Text(subject, style: TextStyle(color: color, fontSize: 12)),
                const SizedBox(height: 8),
                Wrap(
                  spacing: 12,
                  runSpacing: 4,
                  children: [
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.timer_outlined,
                            color: context.greyColor, size: 14),
                        const SizedBox(width: 4),
                        Text('${e['duration_minutes'] ?? '—'} mins',
                            style: TextStyle(
                                color: context.greyColor, fontSize: 12)),
                      ],
                    ),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(Icons.quiz_outlined,
                            color: context.greyColor, size: 14),
                        const SizedBox(width: 4),
                        Text('${e['total_questions'] ?? '—'} questions',
                            style: TextStyle(
                                color: context.greyColor, fontSize: 12)),
                      ],
                    ),
                  ],
                ),
                if (start.isNotEmpty) ...[
                  const SizedBox(height: 6),
                  Row(
                    children: [
                      Icon(Icons.event_outlined,
                          color: context.greyColor, size: 14),
                      const SizedBox(width: 4),
                      Expanded(
                        child: Text(
                          'Opens: ${start.replaceAll('T', ' ').substring(0, start.length > 16 ? 16 : start.length)}',
                          style: TextStyle(
                              color: context.greyColor, fontSize: 12),
                        ),
                      ),
                    ],
                  ),
                ],
                const SizedBox(height: 12),
                OutlinedButton(
                  onPressed: () {
                    setState(() => _selectedTab = 'Results');
                    _loadResults(e['id']?.toString() ?? '');
                  },
                  style: OutlinedButton.styleFrom(
                    foregroundColor: context.accentColor,
                    side: BorderSide(color: context.accentColor),
                  ),
                  child: const Text('View Results'),
                ),
              ],
            ),
          );
        },
      ),
    );
  }

  Widget _resultsView() {
    if (_loadingResults) {
      return Center(
          child: CircularProgressIndicator(color: context.accentColor));
    }
    if (_selectedResults == null) {
      return ListView(
        padding: const EdgeInsets.all(20),
        children: [
          Text('Select a test from My Tests to view results.',
              style: TextStyle(color: context.greyColor)),
          const SizedBox(height: 16),
          ..._exams.map((e) => ListTile(
                title: Text(e['title']?.toString() ?? 'Test',
                    style: TextStyle(color: context.textColor)),
                subtitle: Text(e['subject']?.toString() ?? '',
                    style: TextStyle(color: context.greyColor)),
                trailing: Icon(Icons.chevron_right, color: context.accentColor),
                onTap: () => _loadResults(e['id']?.toString() ?? ''),
              )),
        ],
      );
    }
    final rows = (_selectedResults!['results'] as List?) ?? [];
    final exam = _selectedResults!['exam'] as Map<String, dynamic>?;
    final title = exam?['title']?.toString() ?? 'Test Results';
    return ListView(
      padding: const EdgeInsets.all(20),
      children: [
        Text(title,
            style: TextStyle(
                color: context.textColor,
                fontSize: 17,
                fontWeight: FontWeight.bold)),
        Text('${rows.length} submission(s)',
            style: TextStyle(color: context.greyColor, fontSize: 12)),
        const SizedBox(height: 16),
        if (rows.isEmpty)
          Text('No students have submitted yet.',
              style: TextStyle(color: context.greyColor))
        else
          ...rows.map((r) {
            if (r is! Map) return const SizedBox.shrink();
            return Container(
              margin: const EdgeInsets.only(bottom: 10),
              padding: const EdgeInsets.all(12),
              decoration: BoxDecoration(
                color: context.cardColor,
                borderRadius: BorderRadius.circular(12),
                border: Border.all(color: context.borderColor),
              ),
              child: Row(
                children: [
                  Expanded(
                    child: Text(r['student_name']?.toString() ?? 'Student',
                        style: TextStyle(
                            color: context.textColor,
                            fontWeight: FontWeight.w600)),
                  ),
                  Text('${r['percentage'] ?? r['score'] ?? 0}%',
                      style: TextStyle(
                          color: context.accentColor,
                          fontWeight: FontWeight.bold)),
                ],
              ),
            );
          }),
      ],
    );
  }
}

/// Create tab — build a test manually or extract questions from a PDF/DOCX/JSON
/// file, then assign it to students with an open window.
class CreateExamTab extends StatefulWidget {
  final ApiService api;
  final VoidCallback onCreated;

  const CreateExamTab({super.key, required this.api, required this.onCreated});

  @override
  State<CreateExamTab> createState() => _CreateExamTabState();
}

class _CreateExamTabState extends State<CreateExamTab> {
  final _title = TextEditingController();
  final _subject = TextEditingController();
  final _duration = TextEditingController(text: '30');
  DateTime? _start;
  DateTime? _end;
  final List<Map<String, dynamic>> _questions = [];
  bool _saving = false;
  bool _extracting = false;
  String? _fileName;

  @override
  void dispose() {
    _title.dispose();
    _subject.dispose();
    _duration.dispose();
    super.dispose();
  }

  void _addQuestion() {
    setState(() {
      _questions.add({
        'question_text': '',
        'option_a': '',
        'option_b': '',
        'option_c': '',
        'option_d': '',
        'correct_option': 'A',
      });
    });
  }

  Future<void> _pickDate({required bool isStart}) async {
    final now = DateTime.now();
    final date = await showDatePicker(
      context: context,
      initialDate: now,
      firstDate: now.subtract(const Duration(days: 1)),
      lastDate: now.add(const Duration(days: 365)),
    );
    if (date == null || !mounted) return;
    final time = await showTimePicker(
      context: context,
      initialTime: TimeOfDay.fromDateTime(now.add(const Duration(hours: 1))),
    );
    if (time == null || !mounted) return;
    final value = DateTime(date.year, date.month, date.day, time.hour, time.minute);
    setState(() {
      if (isStart) {
        _start = value;
        if (_end == null || _end!.isBefore(value)) {
          _end = value.add(const Duration(hours: 1));
        }
      } else {
        _end = value;
      }
    });
  }

  String _fmt(DateTime? dt) => dt == null
      ? 'Not set'
      : '${dt.year}-${dt.month.toString().padLeft(2, '0')}-${dt.day.toString().padLeft(2, '0')} '
          '${dt.hour.toString().padLeft(2, '0')}:${dt.minute.toString().padLeft(2, '0')}';

  Future<void> _extractFromFile() async {
    final picked = await pickPostAttachment('pdf');
    if (picked == null || !mounted) return;
    setState(() {
      _extracting = true;
      _fileName = picked.name;
    });
    try {
      final data = await widget.api.previewSchoolExamFile(
        picked.bytes,
        picked.name,
      );
      final qs = (data['questions'] as List?) ?? const [];
      if (qs.isEmpty) throw Exception('No questions found in that file.');
      if (!mounted) return;
      setState(() {
        _questions.clear();
        for (final q in qs) {
          if (q is! Map) continue;
          final opts = (q['options'] as List?) ?? const [];
          String opt(int i) => opts.length > i
              ? (opts[i] is Map
                  ? (opts[i]['text'] ?? '').toString()
                  : opts[i].toString())
              : '';
          _questions.add({
            'question_text': (q['question_text'] ?? q['question'] ?? '')
                .toString(),
            'option_a': opt(0),
            'option_b': opt(1),
            'option_c': opt(2),
            'option_d': opt(3),
            'correct_option': (q['correct_option'] ?? 'A').toString().toUpperCase(),
          });
        }
      });
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('${_questions.length} questions extracted.')),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Text(
              'Could not read questions from that file. Try a clearer PDF or add questions manually.',
            ),
            backgroundColor: Colors.red,
          ),
        );
      }
    } finally {
      if (mounted) setState(() => _extracting = false);
    }
  }

  Future<void> _publish() async {
    if (_saving) return;
    final title = _title.text.trim();
    final subject = _subject.text.trim();
    final duration = int.tryParse(_duration.text.trim()) ?? 0;
    if (title.isEmpty || subject.isEmpty) {
      _snack('Enter a title and subject.');
      return;
    }
    if (duration < 5) {
      _snack('Duration must be at least 5 minutes.');
      return;
    }
    if (_start == null || _end == null) {
      _snack('Set when the test opens and closes.');
      return;
    }
    if (_questions.isEmpty) {
      _snack('Add questions manually or extract from a PDF.');
      return;
    }
    final bad = _questions.any((q) =>
        (q['question_text'] ?? '').toString().trim().isEmpty ||
        (q['correct_option'] ?? '').toString().isEmpty);
    if (bad) {
      _snack('Every question needs text and a correct answer.');
      return;
    }
    setState(() => _saving = true);
    try {
      await widget.api.createSchoolExam(
        title: title,
        subject: subject,
        durationMinutes: duration,
        scheduledStart: _start!,
        scheduledEnd: _end!,
        questions: _questions,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Test published — assigned students can now take it.'),
          backgroundColor: Color(0xFF22C55E),
        ),
      );
      setState(() {
        _title.clear();
        _subject.clear();
        _questions.clear();
        _fileName = null;
        _start = null;
        _end = null;
      });
      widget.onCreated();
    } on ApiException catch (e) {
      _snack(e.message);
    } catch (_) {
      _snack('Could not publish the test. Try again.');
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  void _snack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: Colors.red),
    );
  }

  @override
  Widget build(BuildContext context) {
    return ListView(
      padding: const EdgeInsets.fromLTRB(20, 12, 20, 40),
      children: [
        _card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('New test',
                  style: TextStyle(
                      color: context.textColor,
                      fontWeight: FontWeight.bold,
                      fontSize: 15)),
              const SizedBox(height: 12),
              TextField(
                controller: _title,
                style: TextStyle(color: context.textColor),
                decoration: _dec('Title', 'e.g. Maths — Week 4 test'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _subject,
                style: TextStyle(color: context.textColor),
                decoration: _dec('Subject', 'e.g. Mathematics'),
              ),
              const SizedBox(height: 10),
              TextField(
                controller: _duration,
                keyboardType: TextInputType.number,
                style: TextStyle(color: context.textColor),
                decoration: _dec('Duration (minutes)', '30'),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Expanded(
                    child: _pickTile(
                      label: 'Opens: ${_fmt(_start)}',
                      onTap: () => _pickDate(isStart: true),
                    ),
                  ),
                  const SizedBox(width: 10),
                  Expanded(
                    child: _pickTile(
                      label: 'Closes: ${_fmt(_end)}',
                      onTap: () => _pickDate(isStart: false),
                    ),
                  ),
                ],
              ),
            ],
          ),
        ),
        _card(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text('Questions (${_questions.length})',
                        style: TextStyle(
                            color: context.textColor,
                            fontWeight: FontWeight.bold,
                            fontSize: 15)),
                  ),
                  TextButton.icon(
                    onPressed: _extracting ? null : _extractFromFile,
                    icon: _extracting
                        ? const SizedBox(
                            width: 14,
                            height: 14,
                            child: CircularProgressIndicator(strokeWidth: 2))
                        : const Icon(Icons.upload_file_rounded, size: 18),
                    label: Text(_extracting
                        ? 'Reading…'
                        : (_fileName ?? 'From PDF')),
                  ),
                ],
              ),
              Text(
                'Upload a PDF / Word / JSON paper and questions are extracted automatically — or add them one by one.',
                style: TextStyle(color: context.greyColor, fontSize: 12),
              ),
              const SizedBox(height: 10),
              ..._questions.asMap().entries.map((entry) {
                final i = entry.key;
                return _questionEditor(i, entry.value);
              }),
              const SizedBox(height: 8),
              OutlinedButton.icon(
                onPressed: _addQuestion,
                icon: const Icon(Icons.add, size: 18),
                label: const Text('Add question manually'),
              ),
            ],
          ),
        ),
        SizedBox(
          width: double.infinity,
          child: ElevatedButton.icon(
            onPressed: _saving ? null : _publish,
            icon: _saving
                ? const SizedBox(
                    width: 16,
                    height: 16,
                    child: CircularProgressIndicator(
                        strokeWidth: 2, color: Colors.white))
                : const Icon(Icons.publish_rounded, size: 18),
            label: Text(_saving ? 'Publishing…' : 'Publish & assign to students'),
            style: ElevatedButton.styleFrom(
              backgroundColor: context.accentColor,
              foregroundColor: Colors.white,
              padding: const EdgeInsets.symmetric(vertical: 14),
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.circular(14),
              ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _questionEditor(int index, Map<String, dynamic> q) {
    final letters = ['A', 'B', 'C', 'D'];
    final keys = ['option_a', 'option_b', 'option_c', 'option_d'];
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: context.surfColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: context.borderColor),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              Expanded(
                child: Text('Question ${index + 1}',
                    style: TextStyle(
                        color: context.textColor,
                        fontWeight: FontWeight.w700,
                        fontSize: 13)),
              ),
              GestureDetector(
                onTap: () => setState(() => _questions.removeAt(index)),
                child: Icon(Icons.delete_outline_rounded,
                    color: Colors.red.shade300, size: 20),
              ),
            ],
          ),
          const SizedBox(height: 8),
          TextField(
            controller: TextEditingController(text: q['question_text'] ?? ''),
            onChanged: (v) => q['question_text'] = v,
            maxLines: 2,
            style: TextStyle(color: context.textColor, fontSize: 13),
            decoration: _dec('Question text', 'What is 2 + 2?'),
          ),
          const SizedBox(height: 8),
          Row(
            children: List.generate(4, (i) {
              return Expanded(
                child: Padding(
                  padding: EdgeInsets.only(right: i < 3 ? 6 : 0),
                  child: TextField(
                    controller:
                        TextEditingController(text: q[keys[i]] ?? ''),
                    onChanged: (v) => q[keys[i]] = v,
                    style: TextStyle(color: context.textColor, fontSize: 12),
                    decoration: _dec(letters[i], ''),
                  ),
                ),
              );
            }),
          ),
          const SizedBox(height: 8),
          Wrap(
            spacing: 6,
            children: letters.map((l) {
              final selected = (q['correct_option'] ?? 'A') == l;
              return ChoiceChip(
                label: Text('Correct: $l'),
                selected: selected,
                selectedColor: context.accentColor,
                labelStyle: TextStyle(
                  color: selected ? Colors.white : context.greyColor,
                  fontSize: 12,
                ),
                onSelected: (_) =>
                    setState(() => q['correct_option'] = l),
              );
            }).toList(),
          ),
        ],
      ),
    );
  }

  Widget _card({required Widget child}) {
    return Container(
      width: double.infinity,
      margin: const EdgeInsets.only(bottom: 14),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: context.cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: context.borderColor),
      ),
      child: child,
    );
  }

  Widget _pickTile({required String label, required VoidCallback onTap}) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(12),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
        decoration: BoxDecoration(
          color: context.surfColor,
          borderRadius: BorderRadius.circular(12),
          border: Border.all(color: context.borderColor),
        ),
        child: Row(
          children: [
            Icon(Icons.event_outlined,
                size: 16, color: context.accentColor),
            const SizedBox(width: 8),
            Expanded(
              child: Text(
                label,
                style: TextStyle(color: context.textColor, fontSize: 12),
                maxLines: 1,
                overflow: TextOverflow.ellipsis,
              ),
            ),
          ],
        ),
      ),
    );
  }

  InputDecoration _dec(String label, String hint) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      labelStyle: TextStyle(color: context.greyColor, fontSize: 12),
      hintStyle: TextStyle(color: context.greyColor.withOpacity(0.6)),
      filled: true,
      fillColor: context.surfColor,
      border: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: context.borderColor),
      ),
      enabledBorder: OutlineInputBorder(
        borderRadius: BorderRadius.circular(12),
        borderSide: BorderSide(color: context.borderColor),
      ),
    );
  }
}
