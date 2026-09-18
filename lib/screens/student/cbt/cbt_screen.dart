import 'dart:math' as math;

import 'package:flutter/material.dart';
import '../../../api/api_service.dart';
import '../../../theme/app_theme.dart';
import 'cbt_packages_screen.dart';
import 'cbt_practice_runner_screen.dart';

/// Board-first CBT practice (like the desktop app):
/// - Tabs: JAMB | WAEC | NECO — each loads ONLY that board's question bank.
/// - WAEC/NECO: pick a subject → start. First start registers & locks the
///   subjects; later changes go to admin via a subject-change request.
/// - Locked boards open the coupon/pay dialog before anything else.
/// - Questions auto-cache for offline; new questions sync when online.
class CbtScreen extends StatefulWidget {
  const CbtScreen({super.key, this.initialTab});
  final String? initialTab; // 'JAMB' | 'WAEC' | 'NECO'
  @override
  State<CbtScreen> createState() => _CbtScreenState();
}

class _CbtScreenState extends State<CbtScreen> {
  final _api = ApiService();

  Map<String, dynamic>? _home;
  String _tab = 'JAMB';
  bool _loading = true;
  String? _error;
  List<dynamic> _changeRequests = [];

  // Subject selection for WAEC/NECO first registration (1–9) and JAMB picks
  final Set<String> _picked = {};
  bool _starting = false;

  @override
  void initState() {
    super.initState();
    if (widget.initialTab != null && widget.initialTab!.isNotEmpty) {
      _tab = widget.initialTab!;
    }
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final home = await _api.cbtPracticeHome();
      List<dynamic> reqs = [];
      try {
        reqs = await _api.mySubjectChangeRequests();
      } catch (_) {}
      if (!mounted) return;
      setState(() {
        _home = home;
        _changeRequests = reqs;
        _loading = false;
      });
      _syncBoardsOffline();
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _loading = false;
        _error = 'Could not load CBT: $e';
      });
    }
  }

  Future<void> _syncBoardsOffline() async {
    // The offline cache is warmed when a board is opened; nothing to do here
    // because practice packs are cached per attempt id (server-built papers).
  }

  Map<String, dynamic>? _boardInfo(String board) {
    final types = (_home?['exam_types'] as List?) ?? const [];
    for (final t in types) {
      if (t is Map && (t['exam_type']?.toString() ?? '') == board) {
        return Map<String, dynamic>.from(t);
      }
    }
    return null;
  }

  bool _hasAccess(String board) => _boardInfo(board)?['has_access'] == true;

  Map<String, dynamic> get _settings =>
      (_home?['settings'] as Map<String, dynamic>?) ?? const {};

  List<String> _profileJamb() {
    final p = (_home?['profile'] as Map<String, dynamic>?) ?? const {};
    return ((p['jamb_subjects'] as List?) ?? const [])
        .map((e) => e.toString())
        .toList();
  }

  List<String> _profileSsce() {
    final p = (_home?['profile'] as Map<String, dynamic>?) ?? const {};
    return ((p['ssce_subjects'] as List?) ?? const [])
        .map((e) => e.toString())
        .toList();
  }

  /// Registered subjects for a specific board (WAEC and NECO each keep their
  /// own list; older accounts fall back to the shared ssce_subjects column).
  List<String> _boardRegistered(String board) {
    final p = (_home?['profile'] as Map<String, dynamic>?) ?? const {};
    final own = ((board == 'WAEC' ? p['waec_subjects'] : p['neco_subjects'])
            as List?) ??
        const [];
    if (own.isNotEmpty) return own.map((e) => e.toString()).toList();
    if ((_profileSsceBoard() ?? '') == board) return _profileSsce();
    return const [];
  }

  String? _profileSsceBoard() {
    final p = (_home?['profile'] as Map<String, dynamic>?) ?? const {};
    final v = p['ssce_exam_type']?.toString();
    return (v == null || v.isEmpty) ? null : v.toUpperCase();
  }

  bool _hasPendingRequest(String board) {
    for (final r in _changeRequests) {
      if (r is Map &&
          (r['board']?.toString().toUpperCase() ?? '') == board &&
          (r['status']?.toString() ?? '') == 'pending') {
        return true;
      }
    }
    return false;
  }

  Future<void> _ensureUnlocked(String board) async {
    if (_hasAccess(board)) return;
    // Coupon / Paystack — same dialog the packages screen uses.
    final ok = await showCbtUnlockChoice(context);
    if (ok) await _load();
  }

  bool _ssceStarted() {
    final p = (_home?['profile'] as Map<String, dynamic>?) ?? const {};
    return p['ssce_started'] == true;
  }

  bool _ssceIsRegistered() {
    final registered = _boardRegistered(_tab);
    return registered.isNotEmpty && _ssceStarted();
  }

  /// CONTINUE: register (and lock) the picked subjects without starting an exam.
  Future<void> _registerSubjects() async {
    final board = _tab;
    if (_starting) return;
    if (_picked.isEmpty) {
      _snack('Select your subjects first (up to 9).');
      return;
    }
    setState(() => _starting = true);
    try {
      await _api.cbtRegisterSubjects(board, _picked.toList());
      if (!mounted) return;
      _snack('Subjects saved & locked. Pick one to practice.');
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      if (e.statusCode == 404 || e.statusCode == 405) {
        // Older backend without the register endpoint: its practice-start
        // persists + locks subjects as a side effect, so start the exam now.
        _snack('Saving subjects and opening ${_tab}…');
        try {
          final attempt = await _api.cbtPracticeStart(board, _picked.toList());
          if (!mounted) return;
          await Navigator.push(
            context,
            MaterialPageRoute(
              builder: (_) => CbtPracticeRunnerScreen(attempt: attempt, board: board),
            ),
          );
          await _load();
        } on ApiException catch (e2) {
          if (!mounted) return;
          _snack(e2.message.isEmpty ? 'Could not start exam.' : e2.message);
        }
        return;
      }
      _snack(e.message.isEmpty ? 'Could not save subjects.' : e.message);
    } catch (e) {
      if (!mounted) return;
      _snack('Could not save subjects: $e');
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  Future<void> _startPractice({String? singleSubject}) async {
    final board = _tab;
    if (_starting) return;
    setState(() => _starting = true);
    try {
      await _ensureUnlocked(board);
      if (!_hasAccess(board)) return;

      final subjects = <String>[];
      if (board == 'JAMB') {
        final need = (_settings['jamb_subjects_required'] as num?)?.toInt() ?? 4;
        final profileJamb = _profileJamb();
        if (profileJamb.length == need) {
          subjects.addAll(profileJamb);
        } else {
          if (_picked.length != need) {
            _snack('Select exactly $need JAMB subjects.');
            return;
          }
          subjects.addAll(_picked);
        }
      } else {
        final registered = _boardRegistered(board);
        if (registered.isNotEmpty && _ssceStarted()) {
          if (singleSubject == null ||
              !registered.any((s) => s.toLowerCase() == singleSubject.toLowerCase())) {
            _snack('Pick one of your registered subjects.');
            return;
          }
          subjects.add(singleSubject);
        } else {
          // Not registered yet on this board — CONTINUE saves & locks subjects.
          _snack('Tap CONTINUE to save your subjects first.');
          return;
        }
      }

      final attempt = await _api.cbtPracticeStart(board, subjects);
      if (!mounted) return;
      await Navigator.push(
        context,
        MaterialPageRoute(
          builder: (_) => CbtPracticeRunnerScreen(attempt: attempt, board: board),
        ),
      );
      // Refresh access/locks after returning (first start may have registered).
      await _load();
    } on ApiException catch (e) {
      if (!mounted) return;
      _snack(e.message.isEmpty ? 'Could not start exam.' : e.message);
    } catch (e) {
      if (!mounted) return;
      _snack('Could not start exam: $e');
    } finally {
      if (mounted) setState(() => _starting = false);
    }
  }

  void _snack(String msg) {
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), backgroundColor: const Color(0xFF7C3AED)),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.bgColor,
      appBar: AppBar(
        backgroundColor: context.cardColor,
        elevation: 0,
        title: const Text('CBT Practice'),
        actions: [
          IconButton(icon: const Icon(Icons.refresh), onPressed: _loading ? null : _load),
        ],
      ),
      body: _loading
          ? const Center(child: CircularProgressIndicator())
          : _error != null
              ? _errorView()
              : RefreshIndicator(
                  onRefresh: _load,
                  child: ListView(
                    padding: const EdgeInsets.all(16),
                    children: [
                      _boardTabs(),
                      const SizedBox(height: 16),
                      _boardHeader(),
                      const SizedBox(height: 12),
                      _boardBody(),
                    ],
                  ),
                ),
    );
  }

  Widget _errorView() => Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(_error ?? '', textAlign: TextAlign.center,
                style: TextStyle(color: context.greyColor)),
            const SizedBox(height: 12),
            FilledButton(onPressed: _load, child: const Text('Retry')),
          ],
        ),
      );

  Widget _boardTabs() {
    return Container(
      padding: const EdgeInsets.all(4),
      decoration: BoxDecoration(
        color: context.cardColor,
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: context.borderColor),
      ),
      child: Row(children: [
        for (final board in const ['JAMB', 'WAEC', 'NECO'])
          Expanded(
            child: GestureDetector(
              onTap: () {
                setState(() {
                  _tab = board;
                  _picked.clear();
                });
              },
              child: Container(
                padding: const EdgeInsets.symmetric(vertical: 10),
                decoration: BoxDecoration(
                  color: _tab == board ? context.accentColor : Colors.transparent,
                  borderRadius: BorderRadius.circular(12),
                ),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    _boardLogo(board, size: 20, plain: true),
                    const SizedBox(width: 6),
                    Text(
                      board,
                      style: TextStyle(
                        color: _tab == board ? Colors.white : context.textColor,
                        fontWeight: FontWeight.w800,
                        fontSize: 13,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
      ]),
    );
  }

  Widget _boardLogo(String board, {double size = 44, bool plain = false}) {
    final color = context.accentColor;
    return Container(
      width: size,
      height: size,
      decoration: plain
          ? null
          : BoxDecoration(
              color: color.withOpacity(0.12),
              borderRadius: BorderRadius.circular(12),
            ),
      padding: plain ? EdgeInsets.zero : const EdgeInsets.all(6),
      child: CustomPaint(painter: _BoardSealPainter(board, color: color)),
    );
  }

  Widget _boardHeader() {
    final locked = !_hasAccess(_tab);
    final color = context.accentColor;
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        gradient: LinearGradient(
          colors: [color, color.withOpacity(0.75)],
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(20),
      ),
      child: Row(children: [
        Container(
          width: 56,
          height: 56,
          padding: const EdgeInsets.all(8),
          decoration: BoxDecoration(
            color: Colors.white.withOpacity(0.15),
            borderRadius: BorderRadius.circular(14),
          ),
          child: CustomPaint(painter: _BoardSealPainter(_tab, color: Colors.white)),
        ),
        const SizedBox(width: 14),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('$_tab CBT',
                  style: const TextStyle(
                      color: Colors.white, fontSize: 18, fontWeight: FontWeight.w800)),
              const SizedBox(height: 2),
              Text(
                locked
                    ? 'Locked — unlock with coupon or payment'
                    : _tab == 'JAMB'
                        ? 'One combined exam · all ${_settings['jamb_subjects_required'] ?? 4} subjects'
                        : 'Subject practice from your registered subjects',
                style: TextStyle(color: Colors.white.withOpacity(0.9), fontSize: 12),
              ),
            ],
          ),
        ),
        if (locked)
          FilledButton(
            style: FilledButton.styleFrom(
              backgroundColor: Colors.white,
              foregroundColor: color,
            ),
            onPressed: _starting ? null : () => _ensureUnlocked(_tab),
            child: const Text('Unlock'),
          ),
      ]),
    );
  }

  Widget _boardBody() {
    final board = _tab;
    if (!_hasAccess(board)) {
      return _lockedInfo(board);
    }
    if (board == 'JAMB') return _jambSubjects();
    return _ssceSubjects();
  }

  Widget _lockedInfo(String board) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: context.cardColor,
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: context.borderColor),
      ),
      child: Column(children: [
        Icon(Icons.lock_outline_rounded, color: context.accentColor, size: 40),
        const SizedBox(height: 10),
        const Text('This exam board is locked',
            style: TextStyle(fontWeight: FontWeight.w800, fontSize: 15)),
        const SizedBox(height: 6),
        Text(
          'Unlock $board with your coupon code or an annual package to practise its own question bank.',
          textAlign: TextAlign.center,
          style: TextStyle(color: context.greyColor, fontSize: 13, height: 1.4),
        ),
        const SizedBox(height: 14),
        FilledButton(
          onPressed: _starting ? null : () => _ensureUnlocked(board),
          child: const Text('Enter coupon or pay'),
        ),
      ]),
    );
  }

  Widget _jambSubjects() {
    final need = (_settings['jamb_subjects_required'] as num?)?.toInt() ?? 4;
    final profileJamb = _profileJamb();
    final selectable = profileJamb.isNotEmpty
        ? profileJamb
        : const ['English Language', 'Mathematics', 'Physics', 'Chemistry', 'Biology', 'Economics', 'Government', 'Literature'];
    final locked = profileJamb.length == need;

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(
        locked
            ? 'Your $need JAMB subjects (locked with your registration)'
            : 'Select exactly $need subjects, then START CBT',
        style: TextStyle(color: context.greyColor, fontSize: 12),
      ),
      const SizedBox(height: 12),
      Wrap(
        spacing: 8,
        runSpacing: 8,
        children: selectable.map((s) {
          final on = locked || _picked.contains(s);
          return FilterChip(
            selected: on,
            onSelected: locked
                ? null
                : (_) {
                    setState(() {
                      if (_picked.contains(s)) {
                        _picked.remove(s);
                      } else if (_picked.length < need) {
                        _picked.add(s);
                      } else {
                        _snack('You can only pick $need subjects.');
                      }
                    });
                  },
            label: Text(s),
            selectedColor: context.accentColor.withOpacity(0.25),
            checkmarkColor: context.accentColor,
          );
        }).toList(),
      ),
      const SizedBox(height: 18),
      SizedBox(
        width: double.infinity,
        child: FilledButton.icon(
          onPressed: _starting ? null : _startPractice,
          icon: _starting
              ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
              : const Icon(Icons.play_arrow_rounded),
          label: Text(_starting ? 'Opening…' : 'START CBT'),
        ),
      ),
      const SizedBox(height: 10),
      _changeRequestHint('JAMB', locked),
    ]);
  }

  Widget _ssceSubjects() {
    final registered = _boardRegistered(_tab);
    final isRegistered = _ssceIsRegistered();
    final allSubjects = const [
      'English Language', 'Mathematics', 'Biology', 'Chemistry', 'Physics',
      'Economics', 'Government', 'Literature-in-English', 'CRS', 'IRS',
      'Agricultural Science', 'Commerce', 'Accounting', 'Geography', 'Civic Education',
      'Computer Studies', 'Further Mathematics', 'Hausa', 'Yoruba', 'Igbo', 'French',
    ];

    return Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text(
        isRegistered
            ? 'Your registered subjects — pick one to practise. Subjects are locked; changes need admin approval.'
            : 'Select your subjects (up to 9), then CONTINUE to save them. They lock after that — changes need admin approval.',
        style: TextStyle(color: context.greyColor, fontSize: 12),
      ),
      const SizedBox(height: 12),
      if (isRegistered)
        // Registered subject cards — tap one to open its practice exam.
        ...List.generate(registered.length, (i) {
          final s = registered[i];
          return Padding(
            padding: const EdgeInsets.only(bottom: 10),
            child: Material(
              color: context.cardColor,
              borderRadius: BorderRadius.circular(14),
              child: InkWell(
                borderRadius: BorderRadius.circular(14),
                onTap: _starting ? null : () => _startPractice(singleSubject: s),
                child: Container(
                  padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 14),
                  decoration: BoxDecoration(
                    borderRadius: BorderRadius.circular(14),
                    border: Border.all(color: context.borderColor),
                  ),
                  child: Row(children: [
                    Container(
                      width: 38,
                      height: 38,
                      decoration: BoxDecoration(
                        color: context.accentColor.withOpacity(0.12),
                        borderRadius: BorderRadius.circular(10),
                      ),
                      child: Icon(Icons.menu_book_rounded,
                          size: 20, color: context.accentColor),
                    ),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Text(s,
                          style: const TextStyle(
                              fontWeight: FontWeight.w700, fontSize: 14)),
                    ),
                    Text('$_tab',
                        style: TextStyle(
                            color: context.greyColor, fontSize: 11)),
                    const SizedBox(width: 8),
                    Icon(Icons.chevron_right_rounded,
                        color: context.accentColor),
                  ]),
                ),
              ),
            ),
          );
        })
      else
        Wrap(
          spacing: 8,
          runSpacing: 8,
          children: allSubjects.map((s) {
            final on = _picked.contains(s);
            return FilterChip(
              selected: on,
              onSelected: (_) {
                setState(() {
                  if (_picked.contains(s)) {
                    _picked.remove(s);
                  } else if (_picked.length < 9) {
                    _picked.add(s);
                  } else {
                    _snack('Maximum 9 subjects.');
                  }
                });
              },
              label: Text(s),
              selectedColor: context.accentColor.withOpacity(0.25),
              checkmarkColor: context.accentColor,
            );
          }).toList(),
        ),
      const SizedBox(height: 18),
      if (!isRegistered)
        SizedBox(
          width: double.infinity,
          child: FilledButton.icon(
            onPressed: _starting ? null : _registerSubjects,
            icon: _starting
                ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2))
                : const Icon(Icons.check_rounded),
            label: Text(_starting
                ? 'Saving…'
                : _picked.isEmpty
                    ? 'Select subjects to continue'
                    : 'CONTINUE'),
          ),
        ),
      const SizedBox(height: 10),
      _changeRequestHint(_tab, isRegistered),
    ]);
  }

  Widget _changeRequestHint(String board, bool locked) {
    if (!locked || _hasPendingRequest(board)) {
      if (_hasPendingRequest(board)) {
        return Container(
          padding: const EdgeInsets.all(12),
          decoration: BoxDecoration(
            color: context.cardColor,
            borderRadius: BorderRadius.circular(12),
            border: Border.all(color: context.borderColor),
          ),
          child: Row(children: [
            Icon(Icons.hourglass_top_rounded, size: 18, color: context.accentColor),
            const SizedBox(width: 8),
            Expanded(
              child: Text('Subject-change request waiting for admin approval.',
                  style: TextStyle(color: context.greyColor, fontSize: 12)),
            ),
          ]),
        );
      }
      return const SizedBox.shrink();
    }
    return TextButton.icon(
      onPressed: () => _openChangeRequestDialog(board),
      icon: const Icon(Icons.edit_note_rounded, size: 18),
      label: const Text('Request subject change (admin approves)'),
    );
  }

  Future<void> _openChangeRequestDialog(String board) async {
    final current = board == 'JAMB' ? _profileJamb() : _profileSsce();
    final picked = Set<String>.from(current);
    final reasonCtrl = TextEditingController();
    final ok = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setModal) => Padding(
          padding: EdgeInsets.fromLTRB(
              16, 16, 16, 16 + MediaQuery.of(ctx).viewInsets.bottom),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text('Request $board subject change',
                  style: const TextStyle(fontWeight: FontWeight.w800, fontSize: 16)),
              const SizedBox(height: 4),
              Text('Admin reviews and approves before your subjects change.',
                  style: TextStyle(color: context.greyColor, fontSize: 12)),
              const SizedBox(height: 12),
              Wrap(
                spacing: 8,
                runSpacing: 8,
                children: [
                  ...current,
                  ...const [
                    'English Language', 'Mathematics', 'Biology', 'Chemistry',
                    'Physics', 'Economics', 'Government', 'Literature-in-English',
                    'CRS', 'IRS', 'Agricultural Science', 'Commerce', 'Accounting',
                    'Geography', 'Civic Education', 'Computer Studies',
                    'Further Mathematics', 'French',
                  ],
                ].toSet().map((s) {
                  final on = picked.contains(s);
                  return FilterChip(
                    selected: on,
                    onSelected: (_) => setModal(() {
                      on ? picked.remove(s) : picked.add(s);
                    }),
                    label: Text(s),
                    selectedColor: context.accentColor.withOpacity(0.25),
                  );
                }).toList(),
              ),
              const SizedBox(height: 12),
              TextField(
                controller: reasonCtrl,
                maxLines: 2,
                decoration: const InputDecoration(
                  hintText: 'Why do you need this change? (optional)',
                  border: OutlineInputBorder(),
                ),
              ),
              const SizedBox(height: 12),
              Row(mainAxisAlignment: MainAxisAlignment.end, children: [
                TextButton(onPressed: () => Navigator.pop(ctx, false), child: const Text('Cancel')),
                const SizedBox(width: 8),
                FilledButton(
                  onPressed: picked.isEmpty || picked.toString() == current.toString()
                      ? null
                      : () => Navigator.pop(ctx, true),
                  child: const Text('Send request'),
                ),
              ]),
            ],
          ),
        ),
      ),
    );
    if (ok != true) return;
    try {
      final res = await _api.requestSubjectChange(board, picked.toList(), reason: reasonCtrl.text);
      if (!mounted) return;
      _snack(res['message']?.toString() ?? 'Request sent to admin.');
      await _load();
    } catch (e) {
      if (!mounted) return;
      _snack('Could not send request: $e');
    }
  }
}

/// Simple vector seals so the boards get real logos without adding binary assets.
class _BoardSealPainter extends CustomPainter {
  _BoardSealPainter(this.board, {required this.color});
  final String board;
  final Color color;

  @override
  void paint(Canvas canvas, Size size) {
    final c = Offset(size.width / 2, size.height * 0.42);
    final r = size.width * 0.34;
    final ring = Paint()
      ..style = PaintingStyle.stroke
      ..strokeWidth = size.width * 0.055
      ..color = color;
    final fill = Paint()..color = color;

    if (board == 'JAMB') {
      canvas.drawCircle(c, r, Paint()..color = color.withOpacity(0.15));
      canvas.drawCircle(c, r, ring);
      // open book
      final book = Path()
        ..moveTo(c.dx - r * 0.55, c.dy + r * 0.15)
        ..quadraticBezierTo(c.dx, c.dy - r * 0.1, c.dx + r * 0.55, c.dy + r * 0.15)
        ..lineTo(c.dx + r * 0.55, c.dy + r * 0.45)
        ..quadraticBezierTo(c.dx, c.dy + r * 0.2, c.dx - r * 0.55, c.dy + r * 0.45)
        ..close();
      canvas.drawPath(book, fill);
      // torch star
      _star(canvas, Offset(c.dx, c.dy - r * 0.55), r * 0.22, fill);
    } else if (board == 'WAEC') {
      canvas.drawCircle(c, r, ring);
      // Africa silhouette (simplified)
      final africa = Path()
        ..moveTo(c.dx - r * 0.25, c.dy - r * 0.55)
        ..lineTo(c.dx + r * 0.25, c.dy - r * 0.65)
        ..lineTo(c.dx + r * 0.45, c.dy - r * 0.25)
        ..lineTo(c.dx + r * 0.3, c.dy + r * 0.1)
        ..lineTo(c.dx + r * 0.4, c.dy + r * 0.45)
        ..lineTo(c.dx, c.dy + r * 0.6)
        ..lineTo(c.dx - r * 0.35, c.dy + r * 0.4)
        ..lineTo(c.dx - r * 0.45, c.dy - r * 0.1)
        ..close();
      canvas.drawPath(africa, fill);
    } else {
      // NECO: torch + book
      canvas.drawCircle(c, r, ring);
      _star(canvas, Offset(c.dx, c.dy - r * 0.45), r * 0.24, fill);
      final book = Path()
        ..moveTo(c.dx - r * 0.5, c.dy + r * 0.25)
        ..quadraticBezierTo(c.dx, c.dy, c.dx + r * 0.5, c.dy + r * 0.25)
        ..lineTo(c.dx + r * 0.5, c.dy + r * 0.5)
        ..quadraticBezierTo(c.dx, c.dy + r * 0.25, c.dx - r * 0.5, c.dy + r * 0.5)
        ..close();
      canvas.drawPath(book, fill);
    }
  }

  void _star(Canvas canvas, Offset center, double radius, Paint paint) {
    final path = Path();
    for (var i = 0; i < 8; i++) {
      final angle = i * math.pi / 4;
      final rr = i.isEven ? radius : radius * 0.42;
      final p = Offset(center.dx + rr * math.cos(angle), center.dy + rr * math.sin(angle));
      i == 0 ? path.moveTo(p.dx, p.dy) : path.lineTo(p.dx, p.dy);
    }
    path.close();
    canvas.drawPath(path, paint);
  }

  @override
  bool shouldRepaint(covariant _BoardSealPainter old) =>
      old.board != board || old.color != color;
}
