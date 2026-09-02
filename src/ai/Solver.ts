import {
  ALL_DIRECTIONS,
  type Board,
  cellKey,
  type Cell,
  type Direction,
  isStraightPath,
  ROBOT_COLORS,
  type RobotColor,
  sameCell,
} from '../board/Board';
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
 * Mirrors GameState.hasGenuineRicochet -- replays `moves` from `startRobots`
 * and checks whether `color`'s *own* moves ever redirected, either a single
 * move bent by a deflector or two of its own moves with different
 * directions. Moving some other robot out of the way and then sliding
 * `color` in one unchanged direction into the newly-open cell doesn't count,
 * no matter how many total moves that took -- two of `color`'s own moves in
 * a row in the *same* direction can only happen because another robot
 * cleared the path in between (pressing the same direction again with
 * nothing changed is a no-op the search never even reaches), so that's
 * exactly the shape this rule rejects.
 */
function hasGenuineRicochet(board: Board, startRobots: RobotPositions, moves: readonly Move[], color: RobotColor): boolean {
  const robots = { ...startRobots };
  let ownMoveCount = 0;
  let lastOwnDirection: Direction | null = null;
  let ricocheted = false;
  for (const move of moves) {
    if (move.color === color) {
      ownMoveCount++;
      const occupied = new Set<string>();
      for (const c of ROBOT_COLORS) {
        if (c !== color) occupied.add(cellKey(robots[c].col, robots[c].row));
      }
      const path = board.slidePath(robots[color], move.direction, occupied, color);
      if (!isStraightPath(path)) ricocheted = true;
      else if (lastOwnDirection !== null && lastOwnDirection !== move.direction) ricocheted = true;
      lastOwnDirection = move.direction;
    }
    robots[move.color] = move.to;
  }
  return ownMoveCount === 0 || ricocheted;
}

/** Hands control back to the browser's event loop for one turn -- long enough for a pending DOM update (e.g. a progress message) to actually paint before the next depth's search resumes blocking the main thread. */
function yieldToBrowser(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Breadth-first search over 4-robot-position states, stopping at `maxDepth`.
 * Plain BFS with a visited-state set is simpler than the IDA*-with-heuristics
 * real solvers use, and still guarantees the true optimum (BFS explores
 * strictly shortest-first). Used only on demand (the "Reveal Optimal
 * Solution" button), never as a live opponent, so its only real constraint
 * is staying fast for a genuine solve -- which it mostly is, since every
 * authored target is reachable and a successful search returns as soon as
 * it's found rather than exhaustively scanning the whole space -- but a
 * long solution can still take a real, human-noticeable amount of time (one
 * measured case: ~29s for a genuine 12-move solve), so this is async and
 * yields to the browser between depths (see yieldToBrowser) rather than
 * blocking the tab outright, and reports progress via `onProgress` so a
 * caller can show "Exploring N-move paths..." instead of the page just
 * looking frozen.
 *
 * Per the real rule, the robot landing on the target must genuinely
 * ricochet on the way -- see hasGenuineRicochet -- so a state that merely
 * reaches the target cell isn't automatically accepted; the search keeps
 * going past it if the shot that got there never actually redirected.
 */
export async function solve(
  board: Board,
  startRobots: RobotPositions,
  target: { color: TargetColor; cell: Cell },
  maxDepth = MAX_DEPTH,
  onProgress?: (depth: number) => void,
): Promise<SolveResult> {
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
    onProgress?.(depth + 1);
    await yieldToBrowser();
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
          if (reachesTarget(color, to, target) && hasGenuineRicochet(board, startRobots, newMoves, color)) {
            return { moves: newMoves, count: newMoves.length };
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
