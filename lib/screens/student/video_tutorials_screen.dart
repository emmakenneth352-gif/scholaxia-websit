import 'package:flutter/material.dart';
import 'package:video_player/video_player.dart';
import 'package:webview_flutter/webview_flutter.dart';

import '../../api/api_service.dart';
import '../../theme/app_theme.dart';

class VideoTutorialsScreen extends StatefulWidget {
  const VideoTutorialsScreen({super.key});

  @override
  State<VideoTutorialsScreen> createState() => _VideoTutorialsScreenState();
}

class _VideoTutorialsScreenState extends State<VideoTutorialsScreen> {
  final _api = ApiService();
  final _searchController = TextEditingController();
  List<dynamic> _videos = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _searchController.addListener(() => setState(() {}));
    _load();
  }

  @override
  void dispose() {
    _searchController.dispose();
    super.dispose();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final rows = await _api.videoTutorials();
      if (!mounted) return;
      setState(() {
        _videos = rows;
        _loading = false;
      });
    } catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.toString();
        _loading = false;
      });
    }
  }

  List<dynamic> get _filtered {
    final q = _searchController.text.trim().toLowerCase();
    if (q.isEmpty) return _videos;
    return _videos.where((raw) {
      final v = raw is Map ? raw : <String, dynamic>{};
      final blob = [
        v['title'],
        v['subject'],
        v['topic'],
        v['tutor_name'],
        v['tutor'],
        v['teacher_name'],
        v['channel'],
        v['exam_type'],
      ].whereType<Object>().join(' ').toLowerCase();
      return blob.contains(q);
    }).toList();
  }

  /// Returns true if the URL is a direct video file (mp4, webm, mov etc.)
  bool _isDirectVideo(String url) {
    final lower = url.toLowerCase().split('?').first;
    return lower.endsWith('.mp4') ||
        lower.endsWith('.webm') ||
        lower.endsWith('.mov') ||
        lower.endsWith('.m3u8');
  }

  /// Convert a YouTube watch URL to an embed URL so it loads in the WebView.
  String _embedUrl(String url) {
    // Already an embed URL
    if (url.contains('youtube.com/embed/') ||
        url.contains('youtu.be/embed/')) {
      return url;
    }
    // youtu.be/VIDEO_ID
    final shortRe = RegExp(r'youtu\.be/([A-Za-z0-9_\-]+)');
    final shortMatch = shortRe.firstMatch(url);
    if (shortMatch != null) {
      return 'https://www.youtube.com/embed/${shortMatch.group(1)}?autoplay=1&rel=0';
    }
    // youtube.com/watch?v=VIDEO_ID
    final longRe = RegExp(r'[?&]v=([A-Za-z0-9_\-]+)');
    final longMatch = longRe.firstMatch(url);
    if (longMatch != null) {
      return 'https://www.youtube.com/embed/${longMatch.group(1)}?autoplay=1&rel=0';
    }
    // Any other URL — use as-is inside WebView
    return url;
  }

  void _openVideo(Map v) {
    final rawUrl =
        (v['video_url'] ?? v['url'] ?? '').toString().trim();
    if (rawUrl.isEmpty) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('No video URL for this lesson.')),
      );
      return;
    }

    Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => _VideoPlayerScreen(
          title: (v['title'] ?? 'Video Tutorial').toString(),
          subject: (v['subject'] ?? v['topic'] ?? '').toString(),
          tutor: (v['tutor_name'] ?? v['tutor'] ?? v['teacher_name'] ?? '')
              .toString(),
          url: rawUrl,
          isDirectVideo: _isDirectVideo(rawUrl),
          embedUrl: _embedUrl(rawUrl),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final rows = _filtered;
    return Scaffold(
      backgroundColor: context.bgColor,
      appBar: AppBar(
        backgroundColor: context.headerColor,
        foregroundColor: context.textColor,
        title: const Text('Video Tutorials',
            style: TextStyle(fontWeight: FontWeight.bold)),
        elevation: 0,
        actions: [
          IconButton(
            onPressed: _load,
            icon: const Icon(Icons.refresh),
            tooltip: 'Refresh',
          ),
        ],
      ),
      body: _loading
          ? Center(
              child: CircularProgressIndicator(color: context.accentColor))
          : _error != null
              ? Center(
                  child: Padding(
                    padding: const EdgeInsets.all(24),
                    child: Column(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        const Icon(Icons.error_outline,
                            color: Colors.red, size: 48),
                        const SizedBox(height: 12),
                        Text(_error!,
                            textAlign: TextAlign.center,
                            style: TextStyle(color: context.textColor)),
                        const SizedBox(height: 16),
                        ElevatedButton(
                            onPressed: _load,
                            child: const Text('Retry')),
                      ],
                    ),
                  ),
                )
              : Column(
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(16, 12, 16, 8),
                      child: TextField(
                        controller: _searchController,
                        style: TextStyle(color: context.textColor),
                        decoration: InputDecoration(
                          hintText: 'Search by topic or tutor…',
                          hintStyle:
                              TextStyle(color: context.greyColor),
                          prefixIcon:
                              Icon(Icons.search, color: context.greyColor),
                          filled: true,
                          fillColor: context.surfColor,
                          border: OutlineInputBorder(
                            borderRadius: BorderRadius.circular(12),
                            borderSide: BorderSide.none,
                          ),
                          isDense: true,
                          contentPadding: const EdgeInsets.symmetric(
                              horizontal: 14, vertical: 10),
                        ),
                      ),
                    ),
                    Expanded(
                      child: rows.isEmpty
                          ? Center(
                              child: Padding(
                                padding: const EdgeInsets.all(24),
                                child: Column(
                                  mainAxisSize: MainAxisSize.min,
                                  children: [
                                    Icon(Icons.video_library_outlined,
                                        size: 56,
                                        color: context.greyColor),
                                    const SizedBox(height: 12),
                                    Text(
                                      _searchController.text
                                              .trim()
                                              .isEmpty
                                          ? 'No video tutorials yet.\nAdmin will post lessons here.'
                                          : 'No videos match your search.',
                                      textAlign: TextAlign.center,
                                      style: TextStyle(
                                          color: context.greyColor,
                                          fontSize: 14),
                                    ),
                                  ],
                                ),
                              ),
                            )
                          : RefreshIndicator(
                              onRefresh: _load,
                              color: context.accentColor,
                              child: ListView.separated(
                                padding: const EdgeInsets.all(16),
                                itemCount: rows.length,
                                separatorBuilder: (_, __) =>
                                    const SizedBox(height: 12),
                                itemBuilder: (context, i) {
                                  final v = rows[i] as Map;
                                  final tutor = (v['tutor_name'] ??
                                          v['tutor'] ??
                                          v['teacher_name'] ??
                                          '')
                                      .toString()
                                      .trim();
                                  final subject = (v['subject'] ??
                                          v['topic'] ??
                                          '')
                                      .toString()
                                      .trim();
                                  return _VideoCard(
                                    title:
                                        (v['title'] ?? 'Lesson').toString(),
                                    subject: subject,
                                    tutor: tutor,
                                    onTap: () => _openVideo(
                                        Map<String, dynamic>.from(v)),
                                  );
                                },
                              ),
                            ),
                    ),
                  ],
                ),
    );
  }
}

// ── Video card ─────────────────────────────────────────────────────────────

class _VideoCard extends StatelessWidget {
  final String title;
  final String subject;
  final String tutor;
  final VoidCallback onTap;

  const _VideoCard({
    required this.title,
    required this.subject,
    required this.tutor,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        decoration: BoxDecoration(
          color: context.cardColor,
          borderRadius: BorderRadius.circular(14),
          border: Border.all(color: context.borderColor),
        ),
        child: Row(
          children: [
            // Thumbnail / play icon
            Container(
              width: 88,
              height: 72,
              decoration: BoxDecoration(
                color: context.accentColor.withOpacity(0.15),
                borderRadius: const BorderRadius.only(
                  topLeft: Radius.circular(13),
                  bottomLeft: Radius.circular(13),
                ),
              ),
              child: Icon(Icons.play_circle_fill_rounded,
                  color: context.accentColor, size: 36),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: Padding(
                padding:
                    const EdgeInsets.symmetric(vertical: 12, horizontal: 4),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: TextStyle(
                          color: context.textColor,
                          fontWeight: FontWeight.bold,
                          fontSize: 14),
                      maxLines: 2,
                      overflow: TextOverflow.ellipsis,
                    ),
                    const SizedBox(height: 4),
                    if (subject.isNotEmpty || tutor.isNotEmpty)
                      Text(
                        [
                          if (subject.isNotEmpty) subject,
                          if (tutor.isNotEmpty) 'by $tutor',
                        ].join(' · '),
                        style: TextStyle(
                            color: context.greyColor, fontSize: 11),
                        maxLines: 1,
                        overflow: TextOverflow.ellipsis,
                      ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.only(right: 12),
              child: Icon(Icons.chevron_right,
                  color: context.greyColor, size: 20),
            ),
          ],
        ),
      ),
    );
  }
}

// ── In-app video player screen ─────────────────────────────────────────────

class _VideoPlayerScreen extends StatefulWidget {
  final String title;
  final String subject;
  final String tutor;
  final String url;
  final bool isDirectVideo;
  final String embedUrl;

  const _VideoPlayerScreen({
    required this.title,
    required this.subject,
    required this.tutor,
    required this.url,
    required this.isDirectVideo,
    required this.embedUrl,
  });

  @override
  State<_VideoPlayerScreen> createState() => _VideoPlayerScreenState();
}

class _VideoPlayerScreenState extends State<_VideoPlayerScreen> {
  VideoPlayerController? _vpController;
  bool _vpInitialized = false;
  bool _vpError = false;
  WebViewController? _webController;

  @override
  void initState() {
    super.initState();
    if (widget.isDirectVideo) {
      _initVideoPlayer();
    } else {
      _initWebView();
    }
  }

  void _initVideoPlayer() {
    final ctrl = VideoPlayerController.networkUrl(Uri.parse(widget.url));
    _vpController = ctrl;
    ctrl.initialize().then((_) {
      if (mounted) {
        setState(() => _vpInitialized = true);
        ctrl.play();
      }
    }).catchError((_) {
      if (mounted) setState(() => _vpError = true);
    });
  }

  void _initWebView() {
    final ctrl = WebViewController()
      ..setJavaScriptMode(JavaScriptMode.unrestricted)
      ..setBackgroundColor(Colors.black)
      ..loadRequest(Uri.parse(widget.embedUrl));
    setState(() => _webController = ctrl);
  }

  @override
  void dispose() {
    _vpController?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.black,
      appBar: AppBar(
        backgroundColor: Colors.black,
        foregroundColor: Colors.white,
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(widget.title,
                style: const TextStyle(
                    fontSize: 14, fontWeight: FontWeight.bold),
                maxLines: 1,
                overflow: TextOverflow.ellipsis),
            if (widget.subject.isNotEmpty)
              Text(widget.subject,
                  style: const TextStyle(
                      fontSize: 11, color: Colors.white70),
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis),
          ],
        ),
        elevation: 0,
      ),
      body: Column(
        children: [
          // Video area
          Container(
            color: Colors.black,
            child: AspectRatio(
              aspectRatio: 16 / 9,
              child: widget.isDirectVideo
                  ? _buildDirectPlayer()
                  : _buildWebPlayer(),
            ),
          ),
          // Info panel
          Expanded(
            child: Container(
              color: const Color(0xFF0D0B14),
              padding: const EdgeInsets.all(20),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(widget.title,
                      style: const TextStyle(
                          color: Colors.white,
                          fontSize: 17,
                          fontWeight: FontWeight.bold)),
                  const SizedBox(height: 8),
                  if (widget.subject.isNotEmpty)
                    Row(children: [
                      const Icon(Icons.book_outlined,
                          color: Colors.white54, size: 14),
                      const SizedBox(width: 6),
                      Text(widget.subject,
                          style: const TextStyle(
                              color: Colors.white70, fontSize: 13)),
                    ]),
                  if (widget.tutor.isNotEmpty) ...[
                    const SizedBox(height: 4),
                    Row(children: [
                      const Icon(Icons.person_outline,
                          color: Colors.white54, size: 14),
                      const SizedBox(width: 6),
                      Text(widget.tutor,
                          style: const TextStyle(
                              color: Colors.white70, fontSize: 13)),
                    ]),
                  ],
                ],
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWebPlayer() {
    if (_webController == null) {
      return const Center(
          child: CircularProgressIndicator(color: Colors.white));
    }
    return WebViewWidget(controller: _webController!);
  }

  Widget _buildDirectPlayer() {
    if (_vpError) {
      return const Center(
        child: Text('Could not play this video.',
            style: TextStyle(color: Colors.white70)),
      );
    }
    if (!_vpInitialized || _vpController == null) {
      return const Center(
          child: CircularProgressIndicator(color: Colors.white));
    }
    return Stack(
      alignment: Alignment.center,
      children: [
        VideoPlayer(_vpController!),
        GestureDetector(
          onTap: () {
            setState(() {
              _vpController!.value.isPlaying
                  ? _vpController!.pause()
                  : _vpController!.play();
            });
          },
          child: Container(
            color: Colors.transparent,
            child: AnimatedOpacity(
              opacity: _vpController!.value.isPlaying ? 0.0 : 1.0,
              duration: const Duration(milliseconds: 300),
              child: Container(
                decoration: BoxDecoration(
                  color: Colors.black54,
                  shape: BoxShape.circle,
                ),
                padding: const EdgeInsets.all(12),
                child: Icon(
                  _vpController!.value.isPlaying
                      ? Icons.pause_rounded
                      : Icons.play_arrow_rounded,
                  color: Colors.white,
                  size: 40,
                ),
              ),
            ),
          ),
        ),
        Positioned(
          bottom: 0,
          left: 0,
          right: 0,
          child: VideoProgressIndicator(
            _vpController!,
            allowScrubbing: true,
            colors: VideoProgressColors(
              playedColor: const Color(0xFF7C3AED),
              bufferedColor: Colors.white30,
              backgroundColor: Colors.white10,
            ),
          ),
        ),
      ],
    );
  }
}
