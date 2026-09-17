import 'package:flutter/material.dart';
import '../../../api/api_service.dart';
import '../../../services/cbt_offline_store.dart';
import '../../../theme/app_theme.dart';
import '../../../utils/subject_match.dart';
import 'cbt_exam_screen.dart';

/// Simplified CBT screen:
/// - Practice exams only (no school tab - JAMB takes all 4 subjects at once)
/// - JAMB: Shows as single card, combines all registered subjects into one exam
/// - Start session first, then download exam
/// - Auto-sync: Exams download automatically when user has paid or used coupon
/// - Questions are randomized for each session
/// - 2-column grid layout with cover images
/// - Offline support for practice exams
class CbtScreen extends StatefulWidget {
  const CbtScreen({super.key, this.asPastQuestions = false});

  final bool asPastQuestions;

  @override
  State<CbtScreen> createState() => _CbtScreenState();
}

class _CbtScreenState extends State<CbtScreen> {
  final _api = ApiService();
  final _store = CbtOfflineStore.instance;

  List<dynamic> _practiceExams = [];
  List<dynamic> _jambExams = [];
  List<dynamic> _pastQuestions = [];
  List<String> _jambSubjects = [];
  Set<String> _downloaded = {};
  bool _loadingExams = true;
  
  // Profile info like website
  // Profile exam type/subjects previously shown in a banner; banner removed.
  // Fields kept as parsed profile state in case they're needed later.
  
  // Admin settings for question limits
  int _questionsPerSubject = 40; // Default: 40 questions per subject for JAMB
  
  static const _jambBundleId = '__jamb_bundle__';
  static final _yearRe = RegExp(r'(20\d{2}|19\d{2})');

  @override
  void initState() {
    super.initState();
    _loadExams();
  }

  Future<void> _loadExams() async {
    setState(() => _loadingExams = true);
    try {
      final data = await _api.cbtExamsForMe(
        paperKind: widget.asPastQuestions ? 'past_questions' : 'cbt_practice',
      );
      
      final practice = (data['practice_exams'] as List?) ?? [];
      final jamb = (data['jamb_exams'] as List?) ?? [];
      
      // Separate past questions (those with cover images) from regular practice
      _pastQuestions = practice.where((e) {
        if (e is! Map) return false;
        final cover = e['cover_image']?.toString() ?? e['image_url']?.toString();
        return cover != null && cover.isNotEmpty;
      }).toList();
      
      final regularPractice = practice.where((e) {
        if (e is! Map) return true;
        final cover = e['cover_image']?.toString() ?? e['image_url']?.toString();
        return cover == null || cover.isEmpty;
      }).toList();
      
      // Get profile subjects
      List<String> profileJamb = [];
      try {
        final profile = await _api.getStudentProfile();
        profileJamb = profile.jambSubjects;
        // Check if admin has set a custom question limit
        final settings = data['settings'] as Map<String, dynamic>?;
        if (settings != null) {
          final qps = settings['questions_per_subject'] as num?;
          if (qps != null && qps > 0) {
            _questionsPerSubject = qps.toInt();
          }
        }
      } catch (_) {}
      
      // Get downloaded IDs
      Set<String> ids = {};
      try {
        ids = await _store.downloadedIds();
      } catch (_) {
        ids = {};
      }

      if (mounted) {
        setState(() {
          _practiceExams = regularPractice;
          _jambExams = jamb;
          _jambSubjects = profileJamb;
          _downloaded = ids;
          _loadingExams = false;
        });
      }
      
      // Auto-sync: download all available exams that aren't already downloaded
      _autoSyncExams([...regularPractice, ...jamb, ..._pastQuestions]);
    } catch (e) {
      if (mounted) {
        setState(() => _loadingExams = false);
      }
    }
  }
  
  Future<void> _autoSyncExams(List<dynamic> exams) async {
    for (final exam in exams) {
      if (exam is! Map<String, dynamic>) continue;
      final id = exam['id']?.toString();
      if (id == null || id.isEmpty || id == _jambBundleId) continue;
      
      // Skip if already downloaded
      if (_downloaded.contains(id)) continue;
      
      try {
        final pack = await _api.cbtDownloadExamRaw(id);
        await _store.savePack(id, pack);
        if (mounted) {
          final ids = await _store.downloadedIds();
          setState(() => _downloaded = ids);
        }
      } catch (e) {
        // Continue with other exams even if one fails
        continue;
      }
    }
  }

  List<dynamic> get _currentExams {
    // If user has JAMB subjects, show JAMB as single combined card + other practice exams
    if (_jambSubjects.isNotEmpty && _jambExams.isNotEmpty) {
      final otherExams = _practiceExams.where((e) {
        if (e is! Map) return true;
        final examType = (e['exam_type']?.toString() ?? '').toUpperCase();
        return examType != 'JAMB';
      }).toList();
      
      // Add JAMB bundle as first item
      return [
        {
          'id': _jambBundleId,
          'title': 'Jamb',
          'subject': '',
          'exam_type': 'JAMB',
          'total_questions': null,
          'duration_minutes': null,
          'cover_image': null,
          'is_jamb_bundle': true,
        },
        ...otherExams,
      ];
    }
    return _practiceExams;
  }
  
  List<dynamic> get _pastQuestionsExams {
    return _pastQuestions;
  }
  
  /// One exam per profile subject that admin has uploaded (1–4).
  /// These are always taken together as a single JAMB session.
  List<Map<String, dynamic>> _jambAvailableMembers() {
    if (_jambSubjects.isEmpty) return [];
    final exams = _jambExams
        .whereType<Map>()
        .map((e) => Map<String, dynamic>.from(e))
        .toList();

    final picks = <Map<String, dynamic>>[];
    for (final subj in _jambSubjects) {
      Map<String, dynamic>? best;
      String? bestYear;
      for (final e in exams) {
        if (!subjectMatches(_examSubject(e), [subj])) continue;
        final y = _examYear(e);
        if (best == null) {
          best = e;
          bestYear = y;
          continue;
        }
        if (y != null && (bestYear == null || y.compareTo(bestYear) > 0)) {
          best = e;
          bestYear = y;
        }
      }
      if (best != null) picks.add(best);
    }
    return picks;
  }
  
  String _examSubject(Map e) =>
      (e['subject']?.toString() ?? e['title']?.toString() ?? '').trim();

  String? _examYear(Map e) {
    final explicit = e['year']?.toString() ?? e['exam_year']?.toString();
    if (explicit != null && explicit.trim().isNotEmpty) return explicit.trim();
    final blob = '${e['title'] ?? ''} ${e['description'] ?? ''}';
    return _yearRe.firstMatch(blob)?.group(1);
  }

  Future<void> _startExam(BuildContext context, String examId, Map<String, dynamic> exam) async {
    try {
      // Handle JAMB bundle specially - combines all subjects
      if (examId == _jambBundleId) {
        await _startJambBundle(context);
        return;
      }
      
      // WEBSITE FLOW: Start session FIRST
      final session = await _api.cbtStartSession(examId);
      
      if (!mounted) return;
      
      // Then download exam (or use cached if auto-synced)
      Map<String, dynamic> examData;
      final downloaded = _downloaded.contains(examId);
      
      if (downloaded) {
        // Use cached version (auto-synced)
        final cached = await _store.loadPack(examId);
        examData = cached ?? await _api.cbtDownloadExamRaw(examId);
      } else {
        examData = await _api.cbtDownloadExamRaw(examId);
        // Save for offline
        await _store.savePack(examId, examData);
        final ids = await _store.downloadedIds();
        setState(() => _downloaded = ids);
      }

      final questionsRaw = (examData['questions'] as List?) ?? [];
      final questionsList = questionsRaw.map((q) {
        if (q is Map<String, dynamic>) {
          return CbtQuestion.fromJson(q);
        }
        return CbtQuestion(
          id: q['id']?.toString() ?? '',
          text: q['question_text']?.toString() ?? q['text']?.toString() ?? '',
          options: [
            q['option_a']?.toString() ?? '',
            q['option_b']?.toString() ?? '',
            q['option_c']?.toString() ?? '',
            q['option_d']?.toString() ?? '',
          ].where((o) => o.isNotEmpty).toList(),
          topic: q['topic']?.toString(),
          imageUrl: q['image_url']?.toString(),
          correctOption: q['correct_option']?.toString(),
        );
      }).toList();
      
      // Randomize questions (like website CBT)
      final questions = List<CbtQuestion>.from(questionsList);
      questions.shuffle();
      final duration = session.durationMinutes;
      
      if (!mounted) return;

      // Navigate to exam screen
      if (!mounted) return;
      final ctx = context;
      Navigator.push(
        ctx,
        MaterialPageRoute(
          builder: (_) => CbtExamScreen(
            subject: exam['title']?.toString() ?? 'Exam',
            totalQuestions: questions.length,
            durationSeconds: duration * 60,
            sessionId: session.sessionId,
            questions: questions,
          ),
        ),
      );
    } catch (e) {
      if (mounted) {
        // ignore: use_build_context_synchronously
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not start exam: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }
  
  Future<void> _startJambBundle(BuildContext context) async {
    final members = _jambAvailableMembers();
    if (members.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No JAMB exams available for your subjects'), backgroundColor: Colors.red),
      );
      return;
    }
    
    try {
      // Download all subject exams and limit questions per subject
      final allQuestions = <CbtQuestion>[];
      int totalDuration = 0;
      
      for (final member in members) {
        final id = member['id']?.toString();
        if (id == null || id.isEmpty) continue;
        
        Map<String, dynamic> examData;
        if (_downloaded.contains(id)) {
          final cached = await _store.loadPack(id);
          examData = cached ?? await _api.cbtDownloadExamRaw(id);
        } else {
          examData = await _api.cbtDownloadExamRaw(id);
          await _store.savePack(id, examData);
        }
        
        final questionsRaw = (examData['questions'] as List?) ?? [];
        final subjectQuestions = questionsRaw.map((q) {
          if (q is Map<String, dynamic>) {
            return CbtQuestion.fromJson(q);
          }
          return CbtQuestion(
            id: q['id']?.toString() ?? '',
            text: q['question_text']?.toString() ?? q['text']?.toString() ?? '',
            options: [
              q['option_a']?.toString() ?? '',
              q['option_b']?.toString() ?? '',
              q['option_c']?.toString() ?? '',
              q['option_d']?.toString() ?? '',
            ].where((o) => o.isNotEmpty).toList(),
            topic: q['topic']?.toString(),
            imageUrl: q['image_url']?.toString(),
            correctOption: q['correct_option']?.toString(),
          );
        }).toList();
        
        // Limit questions per subject according to admin setting
        subjectQuestions.shuffle();
        final limitedQuestions = subjectQuestions.take(_questionsPerSubject).toList();
        allQuestions.addAll(limitedQuestions);
        totalDuration += (member['duration_minutes'] as num?)?.toInt() ?? 60;
      }
      
      // Randomize all questions together
      allQuestions.shuffle();
      
      // Update downloaded IDs
      final ids = await _store.downloadedIds();
      if (mounted) setState(() => _downloaded = ids);
      
      if (!mounted) return;
      
      // Navigate to exam screen with combined questions
      final ctx = context;
      Navigator.push(
        ctx,
        MaterialPageRoute(
          builder: (_) => CbtExamScreen(
            subject: 'Jamb',
            totalQuestions: allQuestions.length,
            durationSeconds: totalDuration * 60,
            sessionId: null, // JAMB bundle doesn't have a single session
            questions: allQuestions,
          ),
        ),
      );
    } catch (e) {
      if (mounted) {
        // ignore: use_build_context_synchronously
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Could not start JAMB exam: $e'), backgroundColor: Colors.red),
        );
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final theme = Theme.of(context);
    return Scaffold(
      backgroundColor: theme.scaffoldBackgroundColor,
      appBar: AppBar(
        backgroundColor: context.cardColor,
        elevation: 0,
        title: Text(widget.asPastQuestions ? 'Past Questions' : 'CBT Practice'),
        actions: [
          IconButton(
            icon: const Icon(Icons.refresh),
            onPressed: _loadingExams ? null : _loadExams,
          ),
        ],
      ),
      body: Column(
        children: [
          // Single write-up above the exam list
          if (!widget.asPastQuestions)
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 12, 16, 4),
              child: _guideLine('Real Exam mode, practice with confidence.'),
            ),
          
          // Exam grid
          Expanded(
            child: _loadingExams
                ? const Center(child: CircularProgressIndicator())
                : _buildExamContent(),
          ),
        ],
      ),
    );
  }

  Widget _guideLine(String text) => Text(
    text,
    style: TextStyle(
      color: context.greyColor,
      fontSize: 13,
      height: 1.35,
      fontWeight: FontWeight.w500,
    ),
  );

  Widget _buildExamContent() {
    if (_currentExams.isEmpty && _pastQuestionsExams.isEmpty) {
      return Center(
        child: Text(
          _jambSubjects.isNotEmpty 
              ? 'No JAMB exams available for your subjects yet.'
              : 'No practice exams for your subjects yet.',
          style: TextStyle(color: context.greyColor),
        ),
      );
    }
    
    return SingleChildScrollView(
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          // Past Questions - 2-column grid with cover images
          if (_pastQuestionsExams.isNotEmpty) ...[
            Padding(
              padding: const EdgeInsets.all(16),
              child: Text(
                'Past Questions',
                style: TextStyle(
                  color: context.textColor,
                  fontWeight: FontWeight.bold,
                  fontSize: 18,
                ),
              ),
            ),
            _buildPastQuestionsGrid(),
            const SizedBox(height: 24),
          ],
          
          // Regular Practice Exams - simple list (no cover images)
          if (_currentExams.isNotEmpty) ...[
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 16),
              child: Text(
                'Practice Exams',
                style: TextStyle(
                  color: context.textColor,
                  fontWeight: FontWeight.bold,
                  fontSize: 18,
                ),
              ),
            ),
            const SizedBox(height: 12),
            _buildPracticeExamList(),
          ],
        ],
      ),
    );
  }
  
  Widget _buildPastQuestionsGrid() {
    return GridView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: 16),
      gridDelegate: const SliverGridDelegateWithFixedCrossAxisCount(
        crossAxisCount: 2,
        childAspectRatio: 0.75,
        crossAxisSpacing: 12,
        mainAxisSpacing: 12,
      ),
      itemCount: _pastQuestionsExams.length,
      itemBuilder: (context, index) {
        final exam = _pastQuestionsExams[index] as Map<String, dynamic>;
        final id = exam['id']?.toString() ?? '';
        final title = exam['title']?.toString() ?? 'Exam';
        final subject = exam['subject']?.toString() ?? '';
        final totalQ = (exam['total_questions'] as num?)?.toInt() ?? 0;
        final duration = (exam['duration_minutes'] as num?)?.toInt() ?? 0;
        final coverImage = exam['cover_image']?.toString() ?? exam['image_url']?.toString();

        return Card(
          color: context.cardColor,
          child: InkWell(
            onTap: () => _startExam(context, id, exam),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                // Cover image
                Expanded(
                  flex: 3,
                  child: Container(
                    width: double.infinity,
                    decoration: BoxDecoration(
                      color: context.accentColor.withValues(alpha: 0.1),
                      borderRadius: const BorderRadius.vertical(top: Radius.circular(8)),
                    ),
                    child: coverImage != null && coverImage.isNotEmpty
                        ? ClipRRect(
                            borderRadius: const BorderRadius.vertical(top: Radius.circular(8)),
                            child: Image.network(
                              coverImage,
                              fit: BoxFit.cover,
                              errorBuilder: (context, error, stackTrace) {
                                return Center(
                                  child: Icon(
                                    Icons.quiz,
                                    size: 48,
                                    color: context.accentColor.withValues(alpha: 0.5),
                                  ),
                                );
                              },
                            ),
                          )
                        : Center(
                            child: Icon(
                              Icons.quiz,
                              size: 48,
                              color: context.accentColor.withValues(alpha: 0.5),
                            ),
                          ),
                  ),
                ),
                // Content
                Expanded(
                  flex: 2,
                  child: Padding(
                    padding: const EdgeInsets.all(12),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        // Exam type badge
                        Container(
                          padding: const EdgeInsets.symmetric(horizontal: 6, vertical: 2),
                          decoration: BoxDecoration(
                            color: context.accentColor,
                            borderRadius: BorderRadius.circular(4),
                          ),
                          child: Text(
                            exam['exam_type']?.toString() ?? 'PRACTICE',
                            style: const TextStyle(
                              color: Colors.white,
                              fontSize: 10,
                              fontWeight: FontWeight.bold,
                            ),
                          ),
                        ),
                        const SizedBox(height: 6),
                        // Title
                        Text(
                          title,
                          style: TextStyle(
                            color: context.textColor,
                            fontWeight: FontWeight.bold,
                            fontSize: 13,
                          ),
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: 4),
                        // Subject
                        Text(
                          subject,
                          style: TextStyle(
                            color: context.greyColor,
                            fontSize: 11,
                          ),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const Spacer(),
                        // Info and button
                        Row(
                          children: [
                            Expanded(
                              child: Text(
                                '$totalQ Q · ${duration}m',
                                style: TextStyle(
                                  color: context.greyColor,
                                  fontSize: 10,
                                ),
                              ),
                            ),
                            ElevatedButton(
                              onPressed: () => _startExam(context, id, exam),
                              style: ElevatedButton.styleFrom(
                                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                                minimumSize: Size.zero,
                                tapTargetSize: MaterialTapTargetSize.shrinkWrap,
                              ),
                              child: const Text('Start', style: TextStyle(fontSize: 11)),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        );
      },
    );
  }
  
  Widget _buildPracticeExamList() {
    return ListView.builder(
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      padding: const EdgeInsets.symmetric(horizontal: 16),
      itemCount: _currentExams.length,
      itemBuilder: (context, index) {
        final exam = _currentExams[index] as Map<String, dynamic>;
        final id = exam['id']?.toString() ?? '';
        final title = exam['title']?.toString() ?? 'Exam';
        final subject = exam['subject']?.toString() ?? '';
        final isJambBundle = exam['is_jamb_bundle'] == true;
        final showCounts = !isJambBundle;
        final tileColor =
            isJambBundle ? const Color(0xFFF59E0B) : context.accentColor;

        return Container(
          margin: const EdgeInsets.only(bottom: 14),
          decoration: BoxDecoration(
            color: context.cardColor,
            borderRadius: BorderRadius.circular(20),
            border: Border.all(color: tileColor.withOpacity(0.18)),
            boxShadow: [
              BoxShadow(
                color: Colors.black.withOpacity(0.18),
                blurRadius: 14,
                offset: const Offset(0, 5),
              ),
            ],
          ),
          child: Material(
            color: Colors.transparent,
            child: InkWell(
              borderRadius: BorderRadius.circular(20),
              onTap: () => _startExam(context, id, exam),
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    // Gradient icon tile
                    Container(
                      width: 54,
                      height: 54,
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                          colors: [tileColor, tileColor.withOpacity(0.65)],
                        ),
                        borderRadius: BorderRadius.circular(16),
                        boxShadow: [
                          BoxShadow(
                            color: tileColor.withOpacity(0.35),
                            blurRadius: 12,
                            offset: const Offset(0, 4),
                          ),
                        ],
                      ),
                      child: Icon(
                        isJambBundle ? Icons.school_rounded : Icons.quiz_rounded,
                        color: Colors.white,
                        size: 28,
                      ),
                    ),
                    const SizedBox(width: 14),
                    // Title + subject
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            title,
                            style: TextStyle(
                              color: context.textColor,
                              fontWeight: FontWeight.w800,
                              fontSize: 16,
                            ),
                          ),
                          if (showCounts && subject.isNotEmpty) ...[
                            const SizedBox(height: 3),
                            Text(
                              subject,
                              style: TextStyle(
                                color: context.greyColor,
                                fontSize: 12,
                              ),
                            ),
                          ],
                        ],
                      ),
                    ),
                    const SizedBox(width: 12),
                    // Start Practice pill
                    Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 16, vertical: 10),
                      decoration: BoxDecoration(
                        gradient: LinearGradient(
                          colors: [tileColor, tileColor.withOpacity(0.8)],
                        ),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: const Text(
                        'Start Practice',
                        style: TextStyle(
                          color: Colors.white,
                          fontWeight: FontWeight.w700,
                          fontSize: 13,
                        ),
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
    );
  }
}
