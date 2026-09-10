import 'dart:async';
import 'package:flutter/material.dart';
import 'package:url_launcher/url_launcher.dart';
import '../../../api/api_service.dart';
import '../../../theme/app_theme.dart';

/// Past Questions browse + buy screen.
/// Mirrors the website's past-questions.html — shows real PDFs from the backend
/// catalog and handles guest Paystack checkout (no student account required).
class PastQuestionsScreen extends StatefulWidget {
  const PastQuestionsScreen({super.key});

  @override
  State<PastQuestionsScreen> createState() => _PastQuestionsScreenState();
}

class _PastQuestionsScreenState extends State<PastQuestionsScreen> {
  final _api = ApiService();

  List<Map<String, dynamic>> _all = [];
  List<Map<String, dynamic>> _filtered = [];
  bool _loading = true;
  String? _error;

  // Filters
  String _exam = 'ALL';
  String _subject = '';
  String _sort = 'latest';
  String _search = '';

  List<String> _examTypes = ['ALL'];
  List<String> _subjects = [];

  final _searchCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void dispose() {
    _searchCtrl.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() { _loading = true; _error = null; });
    try {
      final data = await _api.getPastQuestionsCatalog();
      final items = (data['items'] as List? ?? [])
          .whereType<Map>()
          .map((e) => Map<String, dynamic>.from(e))
          .toList();

      // Extract unique exam types and subjects
      final exams = <String>{'ALL'};
      final subjects = <String>{};
      for (final p in items) {
        final ex = (p['exam_type'] ?? '').toString().toUpperCase();
        if (ex.isNotEmpty && ex != 'NULL') exams.add(ex);
        final sub = (p['subject'] ?? '').toString();
        if (sub.isNotEmpty) subjects.add(sub);
      }

      if (mounted) {
        setState(() {
          _all = items;
          _examTypes = exams.toList()..sort();
          _subjects = ['', ...subjects.toList()..sort()];
          _loading = false;
          _applyFilters();
        });
      }
    } catch (e) {
      if (mounted) setState(() { _loading = false; _error = e.toString(); });
    }
  }

  void _applyFilters() {
    var list = List<Map<String, dynamic>>.from(_all);

    if (_exam != 'ALL') {
      list = list.where((p) =>
        (p['exam_type'] ?? '').toString().toUpperCase() == _exam).toList();
    }
    if (_subject.isNotEmpty) {
      list = list.where((p) =>
        (p['subject'] ?? '').toString().toLowerCase() ==
        _subject.toLowerCase()).toList();
    }
    if (_search.isNotEmpty) {
      final q = _search.toLowerCase();
      list = list.where((p) =>
        (p['title'] ?? '').toString().toLowerCase().contains(q) ||
        (p['subject'] ?? '').toString().toLowerCase().contains(q) ||
        (p['exam_type'] ?? '').toString().toLowerCase().contains(q)).toList();
    }

    // Sort
    switch (_sort) {
      case 'price-asc':
        list.sort((a, b) => _price(a).compareTo(_price(b)));
        break;
      case 'price-desc':
        list.sort((a, b) => _price(b).compareTo(_price(a)));
        break;
      case 'title':
        list.sort((a, b) =>
          (a['title'] ?? '').toString().compareTo((b['title'] ?? '').toString()));
        break;
      default: // latest
        list.sort((a, b) {
          final ya = int.tryParse((a['year'] ?? '').toString()) ?? 0;
          final yb = int.tryParse((b['year'] ?? '').toString()) ?? 0;
          return yb.compareTo(ya);
        });
    }

    setState(() => _filtered = list);
  }

  double _price(Map<String, dynamic> p) =>
      double.tryParse(p['price']?.toString() ?? '0') ?? 0;

  String _formatPrice(Map<String, dynamic> p) {
    final price = _price(p);
    if (price <= 0 || p['is_free'] == true) return 'Free';
    return '₦${price.toStringAsFixed(0).replaceAllMapped(
      RegExp(r'(\d{1,3})(?=(\d{3})+(?!\d))'),
      (m) => '${m[1]},',
    )}';
  }

  String _examLabel(String ex) {
    switch (ex.toUpperCase()) {
      case 'COMMON_ENTRANCE': return 'Common Entrance';
      case 'ALL': return 'All Exams';
      default: return ex;
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: context.bgColor,
      appBar: AppBar(
        backgroundColor: context.headerColor,
        foregroundColor: context.textColor,
        title: Row(
          children: [
            Icon(Icons.quiz_outlined, color: context.accentColor, size: 20),
            const SizedBox(width: 8),
            Text('Past Questions',
              style: TextStyle(
                color: context.textColor,
                fontSize: 16,
                fontWeight: FontWeight.bold)),
          ],
        ),
        elevation: 0,
        actions: [
          IconButton(
            onPressed: _load,
            icon: Icon(Icons.refresh, color: context.greyColor),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: _loading
          ? Center(child: CircularProgressIndicator(color: context.accentColor))
          : _error != null
              ? _errorView()
              : Column(
                  children: [
                    _searchBar(context),
                    _examTabs(context),
                    _filterRow(context),
                    Expanded(child: _grid(context)),
                  ],
                ),
    );
  }

  Widget _errorView() => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Icon(Icons.error_outline, color: Colors.red, size: 48),
          const SizedBox(height: 12),
          Text('Could not load past questions',
            textAlign: TextAlign.center,
            style: TextStyle(color: context.textColor, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          Text(_error ?? '', textAlign: TextAlign.center,
            style: TextStyle(color: context.greyColor, fontSize: 12)),
          const SizedBox(height: 16),
          ElevatedButton(onPressed: _load, child: const Text('Retry')),
        ],
      ),
    ),
  );

  Widget _searchBar(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(14, 12, 14, 4),
    child: TextField(
      controller: _searchCtrl,
      style: TextStyle(color: context.textColor),
      decoration: InputDecoration(
        hintText: 'Search Mathematics, English, Biology…',
        hintStyle: TextStyle(color: context.greyColor, fontSize: 13),
        prefixIcon: Icon(Icons.search, color: context.greyColor, size: 18),
        suffixIcon: _search.isNotEmpty
            ? IconButton(
                icon: Icon(Icons.close, color: context.greyColor, size: 16),
                onPressed: () {
                  _searchCtrl.clear();
                  setState(() => _search = '');
                  _applyFilters();
                })
            : null,
        filled: true,
        fillColor: context.surfColor,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(12),
          borderSide: BorderSide.none,
        ),
        contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
      ),
      onChanged: (v) {
        setState(() => _search = v);
        _applyFilters();
      },
    ),
  );

  Widget _examTabs(BuildContext context) => SizedBox(
    height: 42,
    child: ListView.separated(
      padding: const EdgeInsets.symmetric(horizontal: 14),
      scrollDirection: Axis.horizontal,
      itemCount: _examTypes.length,
      separatorBuilder: (_, __) => const SizedBox(width: 8),
      itemBuilder: (_, i) {
        final ex = _examTypes[i];
        final active = ex == _exam;
        return GestureDetector(
          onTap: () {
            setState(() => _exam = ex);
            _applyFilters();
          },
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 7),
            decoration: BoxDecoration(
              color: active ? context.accentColor : context.surfColor,
              borderRadius: BorderRadius.circular(20),
              border: Border.all(
                color: active ? context.accentColor : context.borderColor),
            ),
            child: Text(
              _examLabel(ex),
              style: TextStyle(
                color: active ? Colors.white : context.textColor,
                fontWeight: FontWeight.w600,
                fontSize: 12,
              ),
            ),
          ),
        );
      },
    ),
  );

  Widget _filterRow(BuildContext context) => Padding(
    padding: const EdgeInsets.fromLTRB(14, 6, 14, 8),
    child: Row(
      children: [
        Expanded(child: _dropdown<String>(
          value: _subject,
          items: _subjects,
          labelOf: (s) => s.isEmpty ? 'All subjects' : s,
          onChanged: (v) {
            setState(() => _subject = v ?? '');
            _applyFilters();
          },
        )),
        const SizedBox(width: 8),
        Expanded(child: _dropdown<String>(
          value: _sort,
          items: const ['latest', 'price-asc', 'price-desc', 'title'],
          labelOf: (s) => switch (s) {
            'price-asc'  => 'Price ↑',
            'price-desc' => 'Price ↓',
            'title'      => 'A–Z',
            _            => 'Latest',
          },
          onChanged: (v) {
            setState(() => _sort = v ?? 'latest');
            _applyFilters();
          },
        )),
        const SizedBox(width: 8),
        Text(
          '${_filtered.length} paper${_filtered.length == 1 ? '' : 's'}',
          style: TextStyle(color: context.greyColor, fontSize: 11),
        ),
      ],
    ),
  );

  Widget _dropdown<T>({
    required T value,
    required List<T> items,
    required String Function(T) labelOf,
    required ValueChanged<T?> onChanged,
  }) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 10),
    decoration: BoxDecoration(
      color: context.surfColor,
      borderRadius: BorderRadius.circular(10),
      border: Border.all(color: context.borderColor),
    ),
    child: DropdownButtonHideUnderline(
      child: DropdownButton<T>(
        value: value,
        isExpanded: true,
        dropdownColor: context.cardColor,
        style: TextStyle(color: context.textColor, fontSize: 12),
        items: items.map((e) => DropdownMenuItem(
          value: e,
          child: Text(labelOf(e), overflow: TextOverflow.ellipsis),
        )).toList(),
        onChanged: onChanged,
      ),
    ),
  );

  Widget _grid(BuildContext context) {
    if (_filtered.isEmpty) {
      return Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Icon(Icons.search_off_rounded, size: 48, color: context.greyColor),
            const SizedBox(height: 12),
            Text('No past questions found',
              style: TextStyle(color: context.greyColor)),
          ],
        ),
      );
    }
    return RefreshIndicator(
      onRefresh: _load,
      color: context.accentColor,
      child: ListView.separated(
        padding: const EdgeInsets.fromLTRB(14, 4, 14, 24),
        itemCount: _filtered.length,
        separatorBuilder: (_, __) => const SizedBox(height: 10),
        itemBuilder: (_, i) => _card(context, _filtered[i]),
      ),
    );
  }

  Widget _card(BuildContext context, Map<String, dynamic> p) {
    final title = (p['title'] ?? p['subject'] ?? 'Past Questions').toString();
    final subject = (p['subject'] ?? '').toString();
    final exam = _examLabel((p['exam_type'] ?? '').toString().toUpperCase());
    final year = (p['year'] ?? '').toString();
    final priceLabel = _formatPrice(p);
    final isFree = p['is_free'] == true || _price(p) <= 0;
    final desc = (p['description'] ?? '').toString();

    return Container(
      decoration: BoxDecoration(
        color: context.cardColor,
        borderRadius: BorderRadius.circular(14),
        border: Border.all(color: context.borderColor),
      ),
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
                  decoration: BoxDecoration(
                    color: context.accentColor.withOpacity(0.12),
                    borderRadius: BorderRadius.circular(6),
                  ),
                  child: Text(exam,
                    style: TextStyle(
                      color: context.accentColor,
                      fontSize: 10,
                      fontWeight: FontWeight.bold)),
                ),
                if (year.isNotEmpty) ...[
                  const SizedBox(width: 6),
                  Text('· $year',
                    style: TextStyle(color: context.greyColor, fontSize: 10)),
                ],
                const Spacer(),
                Text(priceLabel,
                  style: TextStyle(
                    color: isFree ? Colors.green : context.accentColor,
                    fontWeight: FontWeight.bold,
                    fontSize: 14)),
              ],
            ),
            const SizedBox(height: 8),
            Text(title,
              style: TextStyle(
                color: context.textColor,
                fontSize: 15,
                fontWeight: FontWeight.bold)),
            if (subject.isNotEmpty) ...[
              const SizedBox(height: 2),
              Text(subject,
                style: TextStyle(color: context.greyColor, fontSize: 12)),
            ],
            if (desc.isNotEmpty) ...[
              const SizedBox(height: 6),
              Text(desc,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: TextStyle(color: context.greyColor, fontSize: 12)),
            ],
            const SizedBox(height: 12),
            SizedBox(
              width: double.infinity,
              child: ElevatedButton(
                onPressed: () => _buy(context, p),
                style: ElevatedButton.styleFrom(
                  backgroundColor: context.accentColor,
                  foregroundColor: Colors.white,
                  shape: RoundedRectangleBorder(
                    borderRadius: BorderRadius.circular(10)),
                  padding: const EdgeInsets.symmetric(vertical: 11),
                  elevation: 0,
                ),
                child: Text(
                  isFree ? 'Download Free' : 'Buy Now →',
                  style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 13)),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _buy(BuildContext context, Map<String, dynamic> product) async {
    final id = product['id']?.toString() ?? '';
    if (id.isEmpty) return;
    final isFree = product['is_free'] == true || _price(product) <= 0;

    // Free paper — open PDF directly if URL available
    if (isFree) {
      final url = product['file_url']?.toString() ?? product['pdf_url']?.toString() ?? '';
      if (url.isNotEmpty) {
        await launchUrl(Uri.parse(url), mode: LaunchMode.externalApplication);
      } else {
        _showSnack('Free paper — link will be available soon.');
      }
      return;
    }

    // Paid paper — show email form then open Paystack in browser
    final emailCtrl = TextEditingController();
    final nameCtrl  = TextEditingController();
    final formKey   = GlobalKey<FormState>();
    var paying = false;

    await showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: context.headerColor,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (ctx) => StatefulBuilder(
        builder: (ctx, setSheetState) => Padding(
          padding: EdgeInsets.only(
            left: 20, right: 20, top: 20,
            bottom: MediaQuery.of(ctx).viewInsets.bottom + 24),
          child: Form(
            key: formKey,
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  product['title']?.toString() ?? 'Past Question',
                  style: TextStyle(
                    color: context.textColor, fontSize: 16,
                    fontWeight: FontWeight.bold)),
                const SizedBox(height: 4),
                Text(_formatPrice(product),
                  style: TextStyle(
                    color: context.accentColor, fontSize: 18,
                    fontWeight: FontWeight.w800)),
                const SizedBox(height: 16),
                TextFormField(
                  controller: emailCtrl,
                  keyboardType: TextInputType.emailAddress,
                  style: TextStyle(color: context.textColor),
                  decoration: _inputDec(context, 'Email for receipt & download link'),
                  validator: (v) {
                    if (v == null || v.isEmpty) return 'Email required';
                    if (!v.contains('@')) return 'Enter a valid email';
                    return null;
                  },
                ),
                const SizedBox(height: 10),
                TextFormField(
                  controller: nameCtrl,
                  style: TextStyle(color: context.textColor),
                  decoration: _inputDec(context, 'Full name (optional)'),
                ),
                const SizedBox(height: 16),
                SizedBox(
                  width: double.infinity,
                  child: ElevatedButton(
                    onPressed: paying ? null : () async {
                      if (!formKey.currentState!.validate()) return;
                      setSheetState(() => paying = true);
                      try {
                        final res = await _api.initPastQuestionGuestPayment(
                          bookId: id,
                          email: emailCtrl.text.trim(),
                          fullName: nameCtrl.text.trim(),
                        );
                        final url = res['authorization_url']?.toString() ?? '';
                        if (url.isEmpty) {
                          _showSnack('Payment unavailable. Try again later.');
                          return;
                        }
                        if (ctx.mounted) Navigator.pop(ctx);
                        await launchUrl(
                          Uri.parse(url),
                          mode: LaunchMode.externalApplication);
                      } on ApiException catch (e) {
                        _showSnack(e.message);
                      } catch (_) {
                        _showSnack('Could not start payment. Check your connection.');
                      } finally {
                        setSheetState(() => paying = false);
                      }
                    },
                    style: ElevatedButton.styleFrom(
                      backgroundColor: context.accentColor,
                      foregroundColor: Colors.white,
                      padding: const EdgeInsets.symmetric(vertical: 14),
                      shape: RoundedRectangleBorder(
                        borderRadius: BorderRadius.circular(12)),
                    ),
                    child: paying
                        ? const SizedBox(
                            height: 18, width: 18,
                            child: CircularProgressIndicator(
                              color: Colors.white, strokeWidth: 2))
                        : const Text('Pay with Paystack',
                            style: TextStyle(fontWeight: FontWeight.bold)),
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  '✓ Instant PDF access · ✓ Secure Paystack · ✓ No account required',
                  textAlign: TextAlign.center,
                  style: TextStyle(color: context.greyColor, fontSize: 10)),
              ],
            ),
          ),
        ),
      ),
    );
  }

  InputDecoration _inputDec(BuildContext context, String hint) => InputDecoration(
    hintText: hint,
    hintStyle: TextStyle(color: context.greyColor, fontSize: 13),
    filled: true,
    fillColor: context.surfColor,
    border: OutlineInputBorder(
      borderRadius: BorderRadius.circular(10),
      borderSide: BorderSide(color: context.borderColor)),
    enabledBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(10),
      borderSide: BorderSide(color: context.borderColor)),
    focusedBorder: OutlineInputBorder(
      borderRadius: BorderRadius.circular(10),
      borderSide: BorderSide(color: context.accentColor)),
    contentPadding: const EdgeInsets.symmetric(horizontal: 14, vertical: 12),
  );

  void _showSnack(String msg) {
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      SnackBar(content: Text(msg), behavior: SnackBarBehavior.floating));
  }
}
