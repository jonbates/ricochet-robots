import { describe, expect, it } from 'vitest';
import { Board, type Cell, ROBOT_COLORS } from '../board/Board';
import type { Target } from '../board/BoardLayout';
import { GameState, type RobotPositions } from './GameState';

// A small isolated board -- not the full 16x16 quadrant board -- purely so
// every coordinate in these tests is hand-verifiable. The red target sits at
// (5,5) with walls on S and E (valid entries: heading south down column 5,
// or heading west along row 5); a lone extra E-wall at (5,0) gives a second,
// independent stopping point in row 0, used to build a genuinely bent
// (direction-changing) 2-move approach without needing a deflector.
const TARGET_CELL: Cell = { col: 5, row: 5 };
const wallSegments = [
  { col: 5, row: 5, dir: 'S' as const },
  { col: 5, row: 5, dir: 'E' as const },
  { col: 5, row: 0, dir: 'E' as const },
];
const board = new Board(wallSegments);

const ROBOTS: RobotPositions = {
  red: { col: 5, row: 0 },
  blue: { col: 0, row: 0 },
  green: { col: 15, row: 15 },
  yellow: { col: 15, row: 0 },
};

const RED_TARGET: Target = { color: 'red', cell: TARGET_CELL, shape: 'square' };
const WARP_TARGET: Target = { color: 'warp', cell: TARGET_CELL, shape: 'swirl' };

function freshState(target: Target = RED_TARGET, robots = ROBOTS) {
  return new GameState(board, robots, target, ['Alice', 'Bob']);
}

describe('GameState bidding', () => {
  it('the first bid of the round starts a 60s window; later bids from other players do not restart it', () => {
    const state = freshState();
    expect(state.bidDeadline).toBeNull();
    state.placeBid(0, 5, 1_000);
    expect(state.bidDeadline).toBe(1_000 + 60_000);
    state.placeBid(1, 3, 50_000);
    expect(state.bidDeadline).toBe(1_000 + 60_000);
  });

  it('a player rebidding replaces their own entry instead of adding a second one', () => {
    const state = freshState();
    state.placeBid(0, 5, 1_000);
    state.placeBid(0, 2, 2_000);
    expect(state.bids).toEqual([{ playerIndex: 0, moves: 2 }]);
  });

  it('ignores negative move counts and bids placed outside the bidding phase', () => {
    const state = freshState();
    state.placeBid(0, -1, 1_000);
    expect(state.bids).toEqual([]);

    state.placeBid(0, 5, 1_000);
    state.tick(1_000 + 60_000); // now attempting
    state.placeBid(1, 4, 2_000);
    expect(state.bids).toEqual([{ playerIndex: 0, moves: 5 }]);
  });

  it('endCountdownEarly is a no-op until someone has actually bid', () => {
    const state = freshState();
    state.endCountdownEarly(1_000);
    expect(state.bidDeadline).toBeNull();

    state.placeBid(0, 5, 1_000);
    state.endCountdownEarly(2_000);
    expect(state.bidDeadline).toBe(2_000);
  });

  it('tick leaves the round in bidding until the deadline actually passes', () => {
    const state = freshState();
    state.placeBid(0, 5, 1_000);
    state.tick(1_000 + 60_000 - 1);
    expect(state.phase).toBe('bidding');
  });

  it('tick sorts bids ascending, enters attempting with the lowest bidder active, and resets the board to the round start', () => {
    const state = freshState();
    state.placeBid(1, 5, 1_000);
    state.placeBid(0, 2, 1_000);
    state.select('red');
    state.tick(1_000 + 60_000);

    expect(state.phase).toBe('attempting');
    expect(state.bids).toEqual([
      { playerIndex: 0, moves: 2 },
      { playerIndex: 1, moves: 5 },
    ]);
    expect(state.activeBid).toEqual({ playerIndex: 0, moves: 2 });
    expect(state.selected).toBeNull();
    expect(state.robots).toEqual(ROBOTS);
  });
});

describe('GameState.remainingMoves / activeBid', () => {
  it('is null before any bidding has resolved', () => {
    const state = freshState();
    expect(state.activeBid).toBeNull();
    expect(state.remainingMoves).toBeNull();
  });

  it('counts down as the active bidder makes moves', () => {
    const state = freshState();
    state.placeBid(0, 3, 0);
    state.tick(60_000);
    expect(state.remainingMoves).toBe(3);
    state.select('red');
    state.move('W'); // slides from (5,0) until it's blocked by blue sitting at (0,0), stopping at (1,0)
    expect(state.remainingMoves).toBe(2);
  });
});

describe('GameState robot movement', () => {
  it('select/deselect only take effect during attempting', () => {
    const state = freshState();
    state.select('red');
    expect(state.selected).toBeNull(); // still bidding -- ignored

    state.placeBid(0, 5, 0);
    state.tick(60_000);
    state.select('red');
    expect(state.selected).toBe('red');
    state.deselect();
    expect(state.selected).toBeNull();
  });

  it('move is a no-op with nothing selected, out of moves, outside attempting, or when the robot cannot move that way', () => {
    const state = freshState();
    expect(state.move('S')).toBe(false); // still bidding

    state.placeBid(0, 1, 0);
    state.tick(60_000);
    expect(state.move('S')).toBe(false); // nothing selected

    state.select('blue');
    expect(state.move('W')).toBe(false); // already resting on the west edge -- can't move that way

    state.select('red');
    expect(state.move('S')).toBe(true); // 1 of 1 moves used
    expect(state.move('E')).toBe(false); // out of moves now
  });

  it('a legal move updates robots and appends to moveHistory with the resolved destination', () => {
    const state = freshState();
    state.placeBid(0, 5, 0);
    state.tick(60_000);
    state.select('red');
    state.move('S');
    expect(state.robots.red).toEqual(TARGET_CELL);
    expect(state.moveHistory).toEqual([{ color: 'red', from: { col: 5, row: 0 }, to: TARGET_CELL, direction: 'S' }]);
  });

  it('undo reverts the last move and pops it off moveHistory; false when there is nothing to undo', () => {
    const state = freshState();
    state.placeBid(0, 5, 0);
    state.tick(60_000);
    expect(state.undo()).toBe(false);

    state.select('red');
    state.move('S');
    expect(state.undo()).toBe(true);
    expect(state.robots.red).toEqual({ col: 5, row: 0 });
    expect(state.moveHistory).toEqual([]);
  });
});

describe('GameState.concede', () => {
  it('hands off to the next backup bidder, resetting the board for their attempt', () => {
    const state = freshState();
    state.placeBid(0, 1, 0);
    state.placeBid(1, 5, 0);
    state.tick(60_000);
    state.select('red');
    state.move('S'); // moves red off its start cell

    state.concede();
    expect(state.phase).toBe('attempting');
    expect(state.activeBid).toEqual({ playerIndex: 1, moves: 5 });
    expect(state.robots).toEqual(ROBOTS);
    expect(state.moveHistory).toEqual([]);
    expect(state.selected).toBeNull();
  });

  it('resolves with no winner once the last bidder concedes', () => {
    const state = freshState();
    state.placeBid(0, 1, 0);
    state.tick(60_000);
    state.concede();
    expect(state.phase).toBe('resolved');
    expect(state.activeBid).toBeNull();
    expect(state.lastRoundWinnerIndex).toBeNull();
  });

  it('is a no-op outside the attempting phase', () => {
    const state = freshState();
    state.concede();
    expect(state.phase).toBe('bidding');
  });
});

describe('GameState.giveUpRound', () => {
  it('resets the board and resolves the round with no winner, from bidding or mid-attempt', () => {
    const fromBidding = freshState();
    fromBidding.giveUpRound();
    expect(fromBidding.phase).toBe('resolved');
    expect(fromBidding.lastRoundWinnerIndex).toBeNull();

    const midAttempt = freshState();
    midAttempt.placeBid(0, 5, 0);
    midAttempt.tick(60_000);
    midAttempt.select('red');
    midAttempt.move('S');
    midAttempt.giveUpRound();
    expect(midAttempt.phase).toBe('resolved');
    expect(midAttempt.robots).toEqual(ROBOTS);
    expect(midAttempt.activeBid).toBeNull();
  });

  it('is a no-op once already resolved', () => {
    const state = freshState();
    state.giveUpRound();
    state.lastRoundWinnerIndex = 0; // sentinel to detect a second no-op call re-running the reset
    state.giveUpRound();
    expect(state.lastRoundWinnerIndex).toBe(0);
  });
});

describe('GameState ricochet rule (isSolved / blockedByRicochetRule)', () => {
  it('is not solved, and not on the target at all, from the starting position', () => {
    const state = freshState();
    expect(state.isSolved()).toBe(false);
    expect(state.blockedByRicochetRule).toBe(false);
  });

  it('counts as solved with zero moves when the round already starts on the target', () => {
    const state = freshState(RED_TARGET, { ...ROBOTS, red: TARGET_CELL });
    expect(state.isSolved()).toBe(true);
    expect(state.blockedByRicochetRule).toBe(false);
  });

  it('rejects a single straight, unbent move onto the target -- the real rule requires at least one ricochet', () => {
    const state = freshState();
    state.placeBid(0, 5, 0);
    state.tick(60_000);
    state.select('red');
    state.move('S'); // straight shot: (5,0) -> (5,5), no direction change
    expect(state.robots.red).toEqual(TARGET_CELL);
    expect(state.isSolved()).toBe(false);
    expect(state.blockedByRicochetRule).toBe(true);
  });

  it('accepts a genuinely bent 2-move approach onto the same target', () => {
    const state = freshState(RED_TARGET, { ...ROBOTS, red: { col: 0, row: 0 } });
    state.placeBid(0, 5, 0);
    state.tick(60_000);
    state.select('red');
    state.move('E'); // (0,0) -> (5,0), stopped by the extra E-wall
    state.move('S'); // (5,0) -> (5,5): a real direction change, not a trivial straight shot
    expect(state.robots.red).toEqual(TARGET_CELL);
    expect(state.isSolved()).toBe(true);
    expect(state.blockedByRicochetRule).toBe(false);
  });

  it('a warp target is satisfied by any robot, and the same straight-shot rule still applies to whichever one moved', () => {
    // Both sub-cases move red out of ROBOTS' default (5,0) first -- otherwise
    // it would sit on blue's path (and, in the straight-shot case, on blue's
    // own starting cell), interfering with the moves under test here.
    const straightShot = freshState(WARP_TARGET, { ...ROBOTS, red: { col: 0, row: 15 }, blue: { col: 5, row: 0 } });
    straightShot.placeBid(0, 5, 0);
    straightShot.tick(60_000);
    straightShot.select('blue');
    straightShot.move('S');
    expect(straightShot.robots.blue).toEqual(TARGET_CELL);
    expect(straightShot.isSolved()).toBe(false);
    expect(straightShot.blockedByRicochetRule).toBe(true);

    const bentApproach = freshState(WARP_TARGET, { ...ROBOTS, red: { col: 0, row: 15 }, blue: { col: 0, row: 0 } });
    bentApproach.placeBid(0, 5, 0);
    bentApproach.tick(60_000);
    bentApproach.select('blue');
    bentApproach.move('E'); // (0,0) -> (5,0), stopped by the extra E-wall (red is no longer there to block it early)
    bentApproach.move('S'); // (5,0) -> (5,5)
    expect(bentApproach.robots.blue).toEqual(TARGET_CELL);
    expect(bentApproach.isSolved()).toBe(true);
  });
});

describe('GameState.recordSuccess', () => {
  it('awards the active bidder a point and resolves the round', () => {
    const state = freshState();
    state.placeBid(1, 5, 0);
    state.tick(60_000);
    state.recordSuccess();
    expect(state.players[1].score).toBe(1);
    expect(state.players[0].score).toBe(0);
    expect(state.lastRoundWinnerIndex).toBe(1);
    expect(state.phase).toBe('resolved');
    expect(state.activeBid).toBeNull();
  });

  it('is a no-op outside attempting or with no active bid', () => {
    const state = freshState();
    state.recordSuccess();
    expect(state.players.every((p) => p.score === 0)).toBe(true);
    expect(state.phase).toBe('bidding');
  });
});

describe('GameState.startNextRound', () => {
  it('locks in wherever robots ended up as the new roundStartRobots and resets round state for bidding', () => {
    const state = freshState();
    state.placeBid(0, 5, 0);
    state.tick(60_000);
    state.select('red');
    state.move('S');
    state.recordSuccess();

    const nextTarget = { color: 'blue' as const, cell: { col: 0, row: 15 }, shape: 'diamond' as const };
    state.startNextRound(nextTarget);

    expect(state.phase).toBe('bidding');
    expect(state.target).toBe(nextTarget);
    expect(state.roundStartRobots.red).toEqual(TARGET_CELL); // carried over from the winning attempt
    expect(state.moveHistory).toEqual([]);
    expect(state.selected).toBeNull();
    expect(state.bids).toEqual([]);
    expect(state.bidDeadline).toBeNull();
    expect(state.lastRoundWinnerIndex).toBeNull();
    for (const c of ROBOT_COLORS) expect(state.robots[c]).toEqual(state.roundStartRobots[c]);
  });
});
