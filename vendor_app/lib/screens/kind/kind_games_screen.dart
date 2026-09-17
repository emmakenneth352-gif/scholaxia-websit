import 'dart:math' as math;

import 'package:flutter/material.dart';
import '../../theme/app_theme.dart';
import '../../widgets/student_ui.dart';
import 'kind_game_screen.dart';
import 'kind_leaf_progress.dart';
import 'kind_shared.dart';

class KindGamesScreen extends StatefulWidget {
  const KindGamesScreen({super.key});

  @override
  State<KindGamesScreen> createState() => _KindGamesScreenState();
}

class _KindGamesScreenState extends State<KindGamesScreen>
    with SingleTickerProviderStateMixin {
  final Map<String, int> _leaves = {};
  late final AnimationController _shimmer;

  @override
  void initState() {
    super.initState();
    _shimmer = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 3),
    )..repeat();
    _loadLeaves();
  }

  @override
  void dispose() {
    _shimmer.dispose();
    super.dispose();
  }

  Future<void> _loadLeaves() async {
    final map = <String, int>{};
    for (final g in kidGames) {
      map[g.id] = await KindLeafProgress.leafLevel(g.id);
    }
    if (mounted) setState(() => _leaves.addAll(map));
  }

  Future<void> _openGame(KidGame g) async {
    await Navigator.push(
      context,
      MaterialPageRoute(
        builder: (_) => KindGameScreen(
          gameId: g.id,
          title: g.title,
          subtitle: g.subtitle,
          icon: g.icon,
          gradient: g.gradient,
          questionBuilder: g.builder,
        ),
      ),
    );
    _loadLeaves();
  }

  @override
  Widget build(BuildContext context) {
    final games = kidGames;

    return Scaffold(
      backgroundColor: context.bgColor,
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.only(bottom: 100),
          children: [
            KindHeroHeader(
              greeting: 'Educational Games',
              subtitle: 'Play to unlock next level. Learn as you play.',
              icon: Icons.videogame_asset_rounded,
              badge: 'KID SAFE',
            ),
            const StudentSectionTitle(title: 'Pick a game'),
            Padding(
              padding: const EdgeInsets.symmetric(horizontal: 20),
              child: GridView.count(
                crossAxisCount: 2,
                shrinkWrap: true,
                physics: const NeverScrollableScrollPhysics(),
                crossAxisSpacing: 16,
                mainAxisSpacing: 16,
                childAspectRatio: 0.78,
                children: List.generate(games.length, (i) {
                  return _GameCard(
                    game: games[i],
                    leaf: _leaves[games[i].id] ?? 1,
                    shimmer: _shimmer,
                    onTap: () => _openGame(games[i]),
                  );
                }),
              ),
            ),
          ],
        ),
      ),
    );
  }
}

class _GameCard extends StatelessWidget {
  final KidGame game;
  final int leaf;
  final Animation<double> shimmer;
  final VoidCallback onTap;

  const _GameCard({
    required this.game,
    required this.leaf,
    required this.shimmer,
    required this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final dark = context.isDark;
    final base = game.gradient.first;

    return GestureDetector(
      onTap: onTap,
      child: AnimatedBuilder(
        animation: shimmer,
        builder: (context, _) {
          // Gentle tilt/wiggle so the cards feel alive and playful.
          final tilt = math.sin(shimmer.value * 2 * math.pi + game.title.length) * 0.025;
          return Transform.rotate(
            angle: tilt,
            child: Container(
              decoration: BoxDecoration(
                borderRadius: BorderRadius.circular(26),
                gradient: LinearGradient(
                  begin: Alignment.topLeft,
                  end: Alignment.bottomRight,
                  colors: game.gradient,
                ),
                boxShadow: [
                  BoxShadow(
                    color: base.withOpacity(0.45),
                    blurRadius: 18,
                    offset: const Offset(0, 10),
                  ),
                ],
              ),
              child: Stack(
                children: [
                  // Decorative bubbles
                  Positioned(
                    right: -18,
                    top: -18,
                    child: Container(
                      width: 86,
                      height: 86,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white.withOpacity(0.14),
                      ),
                    ),
                  ),
                  Positioned(
                    left: -12,
                    bottom: 26,
                    child: Container(
                      width: 46,
                      height: 46,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        color: Colors.white.withOpacity(0.10),
                      ),
                    ),
                  ),
                  // Leaf progress badge
                  Positioned(
                    top: 10,
                    right: 10,
                    child: Container(
                      padding: const EdgeInsets.symmetric(
                          horizontal: 9, vertical: 5),
                      decoration: BoxDecoration(
                        color: Colors.white,
                        borderRadius: BorderRadius.circular(20),
                        boxShadow: [
                          BoxShadow(
                            color: Colors.black.withOpacity(0.15),
                            blurRadius: 6,
                            offset: const Offset(0, 3),
                          ),
                        ],
                      ),
                      child: Row(
                        mainAxisSize: MainAxisSize.min,
                        children: [
                          Icon(Icons.eco_rounded,
                              size: 14, color: base),
                          const SizedBox(width: 3),
                          Text(
                            '$leaf',
                            style: TextStyle(
                              color: base,
                              fontWeight: FontWeight.w900,
                              fontSize: 12,
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                  // Content
                  Padding(
                    padding: const EdgeInsets.fromLTRB(16, 18, 16, 14),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Container(
                          width: 54,
                          height: 54,
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(18),
                            boxShadow: [
                              BoxShadow(
                                color: Colors.black.withOpacity(0.12),
                                blurRadius: 8,
                                offset: const Offset(0, 4),
                              ),
                            ],
                          ),
                          child: Icon(game.icon, color: base, size: 28),
                        ),
                        const Spacer(),
                        Text(
                          game.title,
                          maxLines: 2,
                          overflow: TextOverflow.ellipsis,
                          style: const TextStyle(
                            color: Colors.white,
                            fontSize: 17,
                            height: 1.15,
                            fontWeight: FontWeight.w900,
                          ),
                        ),
                        const SizedBox(height: 4),
                        Text(
                          'Leaf $leaf · ${game.subtitle}',
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                          style: TextStyle(
                            color: Colors.white.withOpacity(0.85),
                            fontSize: 11.5,
                          ),
                        ),
                        const SizedBox(height: 10),
                        Container(
                          padding: const EdgeInsets.symmetric(
                              horizontal: 12, vertical: 7),
                          decoration: BoxDecoration(
                            color: Colors.white,
                            borderRadius: BorderRadius.circular(20),
                          ),
                          child: Row(
                            mainAxisSize: MainAxisSize.min,
                            children: [
                              const Icon(Icons.play_arrow_rounded,
                                  size: 18, color: Color(0xFF7C3AED)),
                              const SizedBox(width: 2),
                              Text(
                                'Play',
                                style: TextStyle(
                                  color: base,
                                  fontWeight: FontWeight.w800,
                                  fontSize: 12,
                                ),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                  // Subtle sheen
                  if (dark)
                    Positioned.fill(
                      child: IgnorePointer(
                        child: DecoratedBox(
                          decoration: BoxDecoration(
                            borderRadius: BorderRadius.circular(26),
                            border: Border.all(
                              color: Colors.white.withOpacity(0.12),
                            ),
                          ),
                        ),
                      ),
                    ),
                ],
              ),
            ),
          );
        },
      ),
    );
  }
}
