import 'package:flutter/material.dart';

/// Non-web fallback. The real implementation lives in web_embed_player_web.dart
/// and is swapped in at compile time via web_embed_player.dart.
class WebEmbedPlayer extends StatelessWidget {
  const WebEmbedPlayer({super.key, required this.url});

  final String url;

  @override
  Widget build(BuildContext context) {
    return const Center(
      child: Text(
        'Embedded video playback is not supported on this device.',
        textAlign: TextAlign.center,
        style: TextStyle(color: Colors.white70),
      ),
    );
  }
}
