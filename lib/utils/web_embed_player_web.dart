import 'dart:html' as html;
import 'dart:ui_web' as ui_web;

import 'package:flutter/material.dart';

/// Flutter-web player that embeds the video inside an HTML <iframe>.
/// Used because `webview_flutter` has no web implementation.
class WebEmbedPlayer extends StatefulWidget {
  const WebEmbedPlayer({super.key, required this.url});

  final String url;

  @override
  State<WebEmbedPlayer> createState() => _WebEmbedPlayerState();
}

class _WebEmbedPlayerState extends State<WebEmbedPlayer> {
  static int _nextId = 0;

  late final String _viewId = 'web-embed-player-${_nextId++}';
  html.IFrameElement? _iframe;

  @override
  void initState() {
    super.initState();
    ui_web.platformViewRegistry.registerViewFactory(_viewId, (int viewId) {
      final frame = html.IFrameElement()
        ..src = widget.url
        ..style.border = 'none'
        ..style.width = '100%'
        ..style.height = '100%'
        ..allow =
            'autoplay; clipboard-write; encrypted-media; picture-in-picture; fullscreen';
      frame.setAttribute('allowfullscreen', 'true');
      _iframe = frame;
      return frame;
    });
  }

  @override
  void didUpdateWidget(covariant WebEmbedPlayer oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (widget.url != oldWidget.url) {
      _iframe?.src = widget.url;
    }
  }

  @override
  void dispose() {
    // Detach the frame so audio/video stops when the screen is popped.
    _iframe?.src = 'about:blank';
    super.dispose();
  }

  @override
  Widget build(BuildContext context) => HtmlElementView(viewType: _viewId);
}
