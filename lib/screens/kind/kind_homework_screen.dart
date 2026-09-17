import 'package:flutter/material.dart';

import '../../api/api_service.dart';
import '../../theme/app_theme.dart';
import '../../utils/post_attachment_picker.dart';
import '../../widgets/student_ui.dart';
import 'kind_shared.dart';

/// Kids Homework — the tutor gives homework (announcement PDF) and the child
/// does it and submits to the tutor, just like the senior students' flow.
class KindHomeworkScreen extends StatefulWidget {
  const KindHomeworkScreen({super.key});

  @override
  State<KindHomeworkScreen> createState() => KindHomeworkScreenState();
}

class KindHomeworkScreenState extends State<KindHomeworkScreen> {
  final _api = ApiService();
  bool _loading = true;
  bool _submitting = false;
  List<dynamic> _announcements = [];
  List<dynamic> _submissions = [];
  Map<String, dynamic>? _teacher;
  PickedAttachment? _picked;
  final _note = TextEditingController();

  @override
  void initState() {
    super.initState();
    load();
  }

  Future<void> load() async {
    if (mounted) setState(() => _loading = true);
    try {
      final results = await Future.wait([
        _api.listTeacherAnnouncements(),
        _api.myAssignmentSubmissions(),
        _api.communityChannels(),
      ]);
      if (!mounted) return;
      setState(() {
        _announcements = results[0];
        _submissions = results[1];
        _loading = false;
      });
    } catch (_) {
      if (mounted) setState(() => _loading = false);
    }
  }

  Future<void> _pickTeacher() async {
    try {
      final teachers = await _api.listPublicTeachers();
      if (!mounted) return;
      final picked = await showDialog<Map<String, dynamic>>(
        context: context,
        builder: (ctx) => AlertDialog(
          backgroundColor: ctx.cardColor,
          shape:
              RoundedRectangleBorder(borderRadius: BorderRadius.circular(20)),
          title: Text(
            'Choose your tutor',
            style: TextStyle(color: ctx.textColor),
          ),
          content: SizedBox(
            width: double.maxFinite,
            height: 320,
            child: (teachers.isEmpty)
                ? Center(
                    child: Text(
                      'No tutors available yet.',
                      style: TextStyle(color: ctx.greyColor),
                    ),
                  )
                : ListView.builder(
                    itemCount: teachers.length,
                    itemBuilder: (_, i) {
                      final t = Map<String, dynamic>.from(teachers[i] as Map);
                      final id = t['user_id']?.toString() ??
                          t['id']?.toString() ??
                          '';
                      final name = t['full_name']?.toString() ??
                          t['name']?.toString() ??
                          'Teacher';
                      return ListTile(
                        leading: CircleAvatar(
                          backgroundColor: KidColors.accent.withOpacity(0.15),
                          child: Text(
                            name.isNotEmpty ? name[0].toUpperCase() : 'T',
                            style: const TextStyle(
                              color: KidColors.accent,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                        ),
                        title: Text(
                          name,
                          style: TextStyle(color: ctx.textColor),
                        ),
                        onTap: () => Navigator.pop(ctx, {'id': id, 'name': name}),
                      );
                    },
                  ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(ctx),
              child: Text('Cancel', style: TextStyle(color: ctx.greyColor)),
            ),
          ],
        ),
      );
      if (picked != null && mounted) {
        setState(() => _teacher = picked);
      }
    } catch (_) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Could not load tutors.')),
        );
      }
    }
  }

  Future<void> _pickFile() async {
    final picked = await pickPostAttachment('pdf');
    if (picked != null && mounted) setState(() => _picked = picked);
  }

  Future<void> _submit() async {
    if (_teacher == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Choose your tutor first.')),
      );
      return;
    }
    if (_picked == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Choose your finished homework (PDF).')),
      );
      return;
    }
    if (_submitting) return;
    setState(() => _submitting = true);
    try {
      final up = await _api.communityUpload(_picked!.bytes, _picked!.name);
      final fileUrl = up['file_url']?.toString() ?? '';
      if (fileUrl.isEmpty) throw Exception('Upload failed.');

      final channels = await _api.communityChannels();
      String channelId = '';
      for (final c in channels) {
        if (c is Map && (c['channel_type']?.toString() == 'general')) {
          channelId = c['id']?.toString() ?? '';
          break;
        }
      }
      channelId = channelId.isNotEmpty
          ? channelId
          : (channels.isNotEmpty
              ? (channels.first['id']?.toString() ?? '')
              : '');
      if (channelId.isEmpty) throw Exception('Could not find a class channel.');

      await _api.submitAssignment(
        channelId: channelId,
        teacherId: _teacher!['id']?.toString() ?? '',
        fileUrl: fileUrl,
        caption: _note.text.trim().isNotEmpty
            ? _note.text.trim()
            : 'Homework from ${_teacher!['name'] ?? 'tutor'}',
      );
      if (!mounted) return;
      setState(() {
        _picked = null;
        _note.clear();
      });
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(
          content: Text('Homework sent to your tutor! 🎉'),
          backgroundColor: Color(0xFF22C55E),
        ),
      );
      await load();
    } catch (e) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(
        SnackBar(
          content: Text(
            e.toString().contains('Upload failed')
                ? 'Could not upload. Check your internet.'
                : 'Could not submit homework. Try again.',
          ),
        ),
      );
    } finally {
      if (mounted) setState(() => _submitting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final pdfs = _announcements.where((a) {
      if (a is! Map) return false;
      final m = (a['media_type'] ?? '').toString().toLowerCase();
      final u = (a['media_url'] ?? '').toString().toLowerCase();
      return m.contains('pdf') || u.endsWith('.pdf');
    }).toList();

    return Scaffold(
      backgroundColor: context.bgColor,
      body: _loading
          ? Center(child: CircularProgressIndicator(color: context.accentColor))
          : RefreshIndicator(
              color: context.accentColor,
              onRefresh: load,
              child: ListView(
                padding: const EdgeInsets.fromLTRB(0, 0, 0, 110),
                children: [
                  KindHeroHeader(
                    greeting: 'Homework',
                    subtitle:
                        'Your tutor gives you homework — do it and send it back!',
                    icon: Icons.assignment_rounded,
                    badge: 'KID SAFE',
                  ),
                  const StudentSectionTitle(title: 'Your homework'),
                  if (pdfs.isEmpty)
                    Padding(
                      padding: const EdgeInsets.symmetric(horizontal: 20),
                      child: _emptyCard(
                        icon: Icons.menu_book_rounded,
                        title: 'No homework yet',
                        text:
                            'When your tutor gives homework, it will appear here.',
                      ),
                    )
                  else
                    ...pdfs.map((a) {
                      final m = a as Map;
                      final title = (m['content'] ?? 'Homework')
                          .toString()
                          .split('\n')
                          .first;
                      final url = m['media_url']?.toString() ?? '';
                      return Padding(
                        padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
                        child: Material(
                          color: context.cardColor,
                          borderRadius: BorderRadius.circular(18),
                          child: InkWell(
                            borderRadius: BorderRadius.circular(18),
                            onTap: () async {
                              if (url.isEmpty) return;
                              Navigator.push(
                                context,
                                MaterialPageRoute(
                                  builder: (_) => _SimplePdfViewer(
                                    title: title,
                                    url: url,
                                  ),
                                ),
                              );
                            },
                            child: Container(
                              padding: const EdgeInsets.all(16),
                              decoration: BoxDecoration(
                                borderRadius: BorderRadius.circular(18),
                                border: Border.all(
                                  color: context.accentColor.withOpacity(0.2),
                                ),
                              ),
                              child: Row(
                                children: [
                                  Container(
                                    width: 46,
                                    height: 46,
                                    decoration: BoxDecoration(
                                      color: const Color(0xFF6366F1)
                                          .withOpacity(0.14),
                                      borderRadius: BorderRadius.circular(14),
                                    ),
                                    child: const Icon(
                                      Icons.picture_as_pdf_rounded,
                                      color: Color(0xFF6366F1),
                                    ),
                                  ),
                                  const SizedBox(width: 14),
                                  Expanded(
                                    child: Text(
                                      title,
                                      maxLines: 2,
                                      overflow: TextOverflow.ellipsis,
                                      style: TextStyle(
                                        color: context.textColor,
                                        fontWeight: FontWeight.w800,
                                        fontSize: 14,
                                      ),
                                    ),
                                  ),
                                  const Icon(
                                    Icons.open_in_new_rounded,
                                    color: Color(0xFF6366F1),
                                    size: 20,
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ),
                      );
                    }),
                  const StudentSectionTitle(title: 'Send to your tutor'),
                  Padding(
                    padding: const EdgeInsets.symmetric(horizontal: 20),
                    child: Container(
                      padding: const EdgeInsets.all(18),
                      decoration: BoxDecoration(
                        color: context.cardColor,
                        borderRadius: BorderRadius.circular(20),
                        border:
                            Border.all(color: context.accentColor.withOpacity(0.2)),
                      ),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          // Step 1 — tutor
                          _stepTile(
                            step: '1',
                            label: _teacher == null
                                ? 'Choose your tutor'
                                : 'Tutor: ${_teacher!['name']}',
                            icon: Icons.person_rounded,
                            onTap: _pickTeacher,
                          ),
                          const SizedBox(height: 12),
                          // Step 2 — file
                          _stepTile(
                            step: '2',
                            label: _picked == null
                                ? 'Choose your finished homework (PDF)'
                                : _picked!.name,
                            icon: Icons.upload_file_rounded,
                            onTap: _pickFile,
                          ),
                          const SizedBox(height: 14),
                          TextField(
                            controller: _note,
                            style: TextStyle(color: context.textColor),
                            decoration: InputDecoration(
                              hintText: 'Write a note to your tutor (optional)',
                              hintStyle:
                                  TextStyle(color: context.greyColor, fontSize: 13),
                              filled: true,
                              fillColor: context.surfColor,
                              border: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(14),
                                borderSide: BorderSide(color: context.borderColor),
                              ),
                              enabledBorder: OutlineInputBorder(
                                borderRadius: BorderRadius.circular(14),
                                borderSide: BorderSide(color: context.borderColor),
                              ),
                            ),
                          ),
                          const SizedBox(height: 14),
                          SizedBox(
                            width: double.infinity,
                            child: ElevatedButton.icon(
                              onPressed: _submitting ? null : _submit,
                              icon: _submitting
                                  ? const SizedBox(
                                      width: 16,
                                      height: 16,
                                      child: CircularProgressIndicator(
                                        strokeWidth: 2,
                                        color: Colors.white,
                                      ),
                                    )
                                  : const Icon(Icons.send_rounded, size: 18),
                              label: Text(_submitting ? 'Sending…' : 'Send homework'),
                              style: ElevatedButton.styleFrom(
                                backgroundColor: const Color(0xFF7C3AED),
                                foregroundColor: Colors.white,
                                padding: const EdgeInsets.symmetric(vertical: 14),
                                shape: RoundedRectangleBorder(
                                  borderRadius: BorderRadius.circular(14),
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  if (_submissions.isNotEmpty) ...[
                    const StudentSectionTitle(title: 'Your results'),
                    ..._submissions.map((s) {
                      if (s is! Map) return const SizedBox.shrink();
                      final graded = (s['result_score'] ?? '')
                          .toString()
                          .isNotEmpty;
                      return Padding(
                        padding: const EdgeInsets.fromLTRB(20, 0, 20, 12),
                        child: Container(
                          padding: const EdgeInsets.all(14),
                          decoration: BoxDecoration(
                            color: context.cardColor,
                            borderRadius: BorderRadius.circular(16),
                            border: Border.all(color: context.borderColor),
                          ),
                          child: Row(
                            children: [
                              Icon(
                                graded
                                    ? Icons.check_circle_rounded
                                    : Icons.schedule_rounded,
                                color: graded
                                    ? const Color(0xFF22C55E)
                                    : context.greyColor,
                                size: 22,
                              ),
                              const SizedBox(width: 12),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: [
                                    Text(
                                      (s['caption'] ?? 'Homework')
                                          .toString(),
                                      style: TextStyle(
                                        color: context.textColor,
                                        fontWeight: FontWeight.w700,
                                        fontSize: 13,
                                      ),
                                    ),
                                    Text(
                                      graded
                                          ? 'Score: ${s['result_score']}'
                                          : 'Waiting for tutor feedback',
                                      style: TextStyle(
                                        color: context.greyColor,
                                        fontSize: 12,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                        ),
                      );
                    }),
                  ],
                ],
              ),
            ),
    );
  }

  Widget _emptyCard({
    required IconData icon,
    required String title,
    required String text,
  }) {
    return Container(
      padding: const EdgeInsets.all(22),
      decoration: BoxDecoration(
        color: context.cardColor,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: context.borderColor),
      ),
      child: Column(
        children: [
          Icon(icon, color: context.greyColor, size: 38),
          const SizedBox(height: 10),
          Text(
            title,
            style: TextStyle(
              color: context.textColor,
              fontWeight: FontWeight.w800,
              fontSize: 14,
            ),
          ),
          const SizedBox(height: 4),
          Text(
            text,
            textAlign: TextAlign.center,
            style: TextStyle(color: context.greyColor, fontSize: 12.5),
          ),
        ],
      ),
    );
  }

  Widget _stepTile({
    required String step,
    required String label,
    required IconData icon,
    required VoidCallback onTap,
  }) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(14),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
        decoration: BoxDecoration(
          color: context.surfColor,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: context.borderColor),
        ),
        child: Row(
          children: [
            Container(
              width: 30,
              height: 30,
              alignment: Alignment.center,
              decoration: BoxDecoration(
                gradient: AppGradients.primaryButton,
                shape: BoxShape.circle,
              ),
              child: Text(
                step,
                style: const TextStyle(
                  color: Colors.white,
                  fontWeight: FontWeight.w900,
                  fontSize: 13,
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Text(
                label,
                style: TextStyle(
                  color: context.textColor,
                  fontSize: 13,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ),
            Icon(icon, color: context.accentColor, size: 20),
          ],
        ),
      ),
    );
  }
}

/// Very small PDF viewer for homework papers (web renders inline via browser).
class _SimplePdfViewer extends StatelessWidget {
  final String title;
  final String url;

  const _SimplePdfViewer({required this.title, required this.url});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.bgColor,
      appBar: AppBar(
        title: Text(title, style: TextStyle(color: context.textColor)),
        backgroundColor: context.cardColor,
        iconTheme: IconThemeData(color: context.textColor),
      ),
      body: const Center(
        child: Text(
          'PDF preview — open from your tutor\'s message.',
          textAlign: TextAlign.center,
        ),
      ),
    );
  }
}
