import { ALL_DIRECTIONS, type Board, cellKey, type Cell, isStraightPath, ROBOT_COLORS, type RobotColor, sameCell } from '../board/Board';
import type { Move, RobotPositions } from '../game/GameState';
import type { TargetColor } from '../board/BoardLayout';

export interface SolveResult {
  moves: Move[];
  count: number;
}

const MAX_DEPTH = 20;

function encode(robots: RobotPositions): string {
  return ROBOT_COLORS.map((c) => `${robots[c].col},${robots[c].row}`).join('|');
}

function cloneWith(robots: RobotPositions, color: RobotColor, cell: Cell): RobotPositions {
  return { ...robots, [color]: cell };
}

function reachesTarget(color: RobotColor, to: Cell, target: { color: TargetColor; cell: Cell }): boolean {
  if (!sameCell(to, target.cell)) return false;
  return target.color === 'warp' || target.color === color;
}

/**
 * Breadth-first search over 4-robot-position states, stopping at `maxDepth`.
 * Plain BFS with a visited-state set is simpler than the IDA*-with-heuristics
 * real solvers use, and still guarantees the true optimum (BFS explores
 * strictly shortest-first). Used only on demand (the "Reveal Optimal
 * Solution" button), never as a live opponent, so its only real constraint
 * is staying fast for a genuine solve -- which it is, since every authored
 * target is reachable and a successful search returns as soon as it's found
 * rather than exhaustively scanning the whole space (that exhaustive-scan
 * cost only shows up when proving a target is *unreachable*, which never
 * happens against this board).
 *
 * Per the real rule, a target robot that was already lined up for a direct,
 * unbent shot doesn't count as solved by taking it -- it must ricochet at
 * least once on the way. A single straight first move that happens to land
 * on the target is the only shape of solution this can actually produce
 * (every move after the first already implies at least one prior stop-and-
 * turn), so that's the one case checked and rejected below; the search then
 * keeps going to find a genuinely valid route instead.
 */
export function solve(
  board: Board,
  startRobots: RobotPositions,
  target: { color: TargetColor; cell: Cell },
  maxDepth = MAX_DEPTH,
): SolveResult {
  if (ROBOT_COLORS.some((c) => reachesTarget(c, startRobots[c], target))) {
    return { moves: [], count: 0 };
  }

  interface QueueItem {
    robots: RobotPositions;
    moves: Move[];
  }

  const visited = new Set<string>([encode(startRobots)]);
  let queue: QueueItem[] = [{ robots: startRobots, moves: [] }];

  for (let depth = 0; depth < maxDepth; depth++) {
    const next: QueueItem[] = [];
    for (const item of queue) {
      for (const color of ROBOT_COLORS) {
        const occupied = new Set<string>();
        for (const c of ROBOT_COLORS) {
          if (c !== color) occupied.add(cellKey(item.robots[c].col, item.robots[c].row));
        }
        const from = item.robots[color];

        for (const dir of ALL_DIRECTIONS) {
          const to = board.slideDestination(from, dir, occupied, color);
          if (sameCell(from, to)) continue;

          const newRobots = cloneWith(item.robots, color, to);
          const key = encode(newRobots);
          if (visited.has(key)) continue;
          visited.add(key);

          const newMoves = [...item.moves, { color, from, to, direction: dir }];
          if (reachesTarget(color, to, target)) {
            const isTrivialStraightShot = newMoves.length === 1 && isStraightPath(board.slidePath(from, dir, occupied, color));
            if (!isTrivialStraightShot) return { moves: newMoves, count: newMoves.length };
          }
          next.push({ robots: newRobots, moves: newMoves });
        }
      }
    }
    queue = next;
    if (queue.length === 0) break;
  }

  throw new Error(`No solution found for the ${target.color} target within depth ${maxDepth}`);
}
