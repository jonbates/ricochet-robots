import { describe, expect, it } from 'vitest';
import { Board, ROBOT_COLORS, type Cell, cellKey, sameCell } from '../board/Board';
import { INITIAL_ROBOTS, TARGETS, WALL_SEGMENTS } from '../board/BoardLayout';
import type { RobotPositions } from '../game/GameState';
import { AI_SEARCH_DEPTH, solve, trySolve } from './Solver';

const board = new Board(WALL_SEGMENTS);

/** Replays a solver's moves through the real Board.slideDestination to confirm every step is actually legal (not just internally self-consistent) and that it truly lands on the target. */
function replayReachesTarget(startRobots: RobotPositions, moves: { color: (typeof ROBOT_COLORS)[number]; to: Cell }[], target: { color: (typeof ROBOT_COLORS)[number]; cell: Cell }): boolean {
  const robots: RobotPositions = { ...startRobots };
  for (const move of moves) {
    const occupied = new Set<string>();
    for (const c of ROBOT_COLORS) if (c !== move.color) occupied.add(cellKey(robots[c].col, robots[c].row));
    const actualDest = board.slideDestination(robots[move.color], directionOf(robots[move.color], move.to), occupied);
    if (!sameCell(actualDest, move.to)) return false;
    robots[move.color] = move.to;
  }
  return sameCell(robots[target.color], target.cell);
}

function directionOf(from: Cell, to: Cell): 'N' | 'E' | 'S' | 'W' {
  if (to.col > from.col) return 'E';
  if (to.col < from.col) return 'W';
  if (to.row > from.row) return 'S';
  return 'N';
}

describe('solve', () => {
  it('returns zero moves when the target robot is already there', () => {
    const target = TARGETS[0];
    const robots: RobotPositions = { ...INITIAL_ROBOTS, [target.color]: target.cell };
    const result = solve(board, robots, target);
    expect(result).toEqual({ moves: [], count: 0 });
  });

  it('finds the direct single-move solution when the robot is already aligned with a target wall', () => {
    // Red target (3,3) has walls on S and E -- starting due north of it in the
    // same column, sliding south lands directly on it in exactly one move.
    const target = TARGETS.find((t) => t.color === 'red')!;
    const robots: RobotPositions = { ...INITIAL_ROBOTS, red: { col: 3, row: 0 } };
    const result = solve(board, robots, target);
    expect(result.count).toBe(1);
    expect(result.moves).toEqual([{ color: 'red', from: { col: 3, row: 0 }, to: { col: 3, row: 3 } }]);
  });

  it.each(TARGETS)('finds a genuinely legal solution to the $color target from the initial layout', (target) => {
    const result = solve(board, INITIAL_ROBOTS, target);
    expect(result.count).toBe(result.moves.length);
    expect(result.count).toBeGreaterThan(0);
    expect(replayReachesTarget(INITIAL_ROBOTS, result.moves, target)).toBe(true);
  });

  it('uses another robot as a blocker to line up an approach the target wall alone cannot stop', () => {
    // Red starts south of row 3 in column 1, nowhere near either of the
    // target's two open approach lanes (column 3 from the north, row 3 from
    // the west). A blocker parked at (1,2) is what stops red's first slide
    // exactly on row 3 -- without it, red would overshoot all the way to the
    // north edge instead. From there, row 3's clear run east into the
    // target's E wall finishes it in one more move.
    const target = TARGETS.find((t) => t.color === 'red')!;
    const robots: RobotPositions = {
      ...INITIAL_ROBOTS,
      red: { col: 1, row: 10 },
      blue: { col: 1, row: 2 },
    };
    const result = solve(board, robots, target);
    expect(result.count).toBe(2);
    expect(result.moves).toEqual([
      { color: 'red', from: { col: 1, row: 10 }, to: { col: 1, row: 3 } },
      { color: 'red', from: { col: 1, row: 3 }, to: { col: 3, row: 3 } },
    ]);
  });
});

describe('trySolve (the AI opponent bounded search)', () => {
  // All 4 robots clustered in the open interior, far from any target's wall --
  // the true optimum needs 8 moves, well past AI_SEARCH_DEPTH, so the AI
  // should give up on this one rather than (impossibly) still finding it.
  const hardRobots: RobotPositions = {
    red: { col: 6, row: 6 },
    blue: { col: 9, row: 6 },
    green: { col: 6, row: 9 },
    yellow: { col: 9, row: 9 },
  };
  const hardTarget = TARGETS.find((t) => t.color === 'red')!;

  it('gives up within its search budget on a target whose true optimum exceeds it', () => {
    expect(solve(board, hardRobots, hardTarget, 20).count).toBe(8);
    expect(trySolve(board, hardRobots, hardTarget, AI_SEARCH_DEPTH)).toBeNull();
  });

  it('still finds the true optimum when it fits within the budget', () => {
    const target = TARGETS.find((t) => t.color === 'red')!;
    const robots: RobotPositions = { ...INITIAL_ROBOTS, red: { col: 3, row: 0 } };
    expect(trySolve(board, robots, target, AI_SEARCH_DEPTH)).toEqual({
      moves: [{ color: 'red', from: { col: 3, row: 0 }, to: { col: 3, row: 3 } }],
      count: 1,
    });
  });
});
