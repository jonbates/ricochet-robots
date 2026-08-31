import { describe, expect, it } from 'vitest';
import { Board, isStraightPath, rotateCellInBlock, rotateDeflectorOrientation, rotateDirection } from './Board';
import { buildBoardVariant } from './BoardLayout';

// A fixed quadrant assignment for reproducible tests -- tile 0 ("A") lands at
// NW with the identity rotation (0 steps), so its locally-authored target
// positions (red (3,6) SW, blue (6,5) NE, green (1,2) NW, yellow (6,1) SE)
// carry over to global coordinates completely unchanged, which is what these
// tests reason about directly.
const FIXED_ASSIGNMENT = { NW: 0, NE: 1, SW: 2, SE: 3 };

describe('Board.slideDestination (classic board)', () => {
  const board = new Board(buildBoardVariant('classic', FIXED_ASSIGNMENT).wallSegments);

  it('slides across an open lane all the way to the board edge', () => {
    const dest = board.slideDestination({ col: 6, row: 3 }, 'W', new Set(), 'red');
    expect(dest).toEqual({ col: 0, row: 3 });
  });

  it('cannot move past an edge it is already resting on', () => {
    const dest = board.slideDestination({ col: 0, row: 3 }, 'W', new Set(), 'red');
    expect(dest).toEqual({ col: 0, row: 3 });
  });

  it('stops at the red target cell approaching from the north (its S wall)', () => {
    const dest = board.slideDestination({ col: 3, row: 0 }, 'S', new Set(), 'red');
    expect(dest).toEqual({ col: 3, row: 6 });
  });

  it('stops at the red target cell approaching from the east (its W wall)', () => {
    const dest = board.slideDestination({ col: 5, row: 6 }, 'W', new Set(), 'red');
    expect(dest).toEqual({ col: 3, row: 6 });
  });

  it('does not stop at the red target approaching from the south -- the S wall blocks entry from that side', () => {
    // Starts a couple rows south of the (3,6) red target, in the same
    // column, with nothing else in between -- so only the target's own S
    // wall is in play.
    const dest = board.slideDestination({ col: 3, row: 9 }, 'N', new Set(), 'red');
    expect(dest).toEqual({ col: 3, row: 7 });
  });

  it('stops one cell short of another robot instead of at the wall/edge beyond it', () => {
    const occupied = new Set(['0,5']);
    const dest = board.slideDestination({ col: 0, row: 0 }, 'S', occupied, 'red');
    expect(dest).toEqual({ col: 0, row: 4 });
  });

  it('never lets a robot enter the center vault from any side', () => {
    expect(board.slideDestination({ col: 0, row: 7 }, 'E', new Set(), 'red')).toEqual({ col: 6, row: 7 });
    expect(board.slideDestination({ col: 15, row: 8 }, 'W', new Set(), 'red')).toEqual({ col: 9, row: 8 });
    expect(board.slideDestination({ col: 7, row: 0 }, 'S', new Set(), 'red')).toEqual({ col: 7, row: 6 });
    // Column 8's own approach is stopped even earlier than the vault's own
    // wall -- by a target's wall at (8,11) -- which still demonstrates the
    // robot never reaches the vault, just via a different, closer obstacle.
    expect(board.slideDestination({ col: 8, row: 15 }, 'N', new Set(), 'red')).toEqual({ col: 8, row: 11 });
  });
});

describe('Board.slideDestination (deflectors)', () => {
  // Isolated single-deflector boards (no other walls) so each case tests
  // exactly one thing: the mirror-reflection table itself, independent of
  // the production diagonal board's specific layout.
  function boardWith(orientation: '/' | '\\', color: 'red' | 'blue' = 'blue') {
    return new Board([], [{ col: 5, row: 5, orientation, color }]);
  }

  it('passes straight through a deflector of the same color, in every direction', () => {
    const board = boardWith('\\', 'red');
    expect(board.slideDestination({ col: 0, row: 5 }, 'E', new Set(), 'red')).toEqual({ col: 15, row: 5 });
    expect(board.slideDestination({ col: 5, row: 0 }, 'S', new Set(), 'red')).toEqual({ col: 5, row: 15 });
  });

  it('a "\\\\" deflector turns a mismatched-color robot: E->S, S->E, N->W, W->N', () => {
    const board = boardWith('\\');
    expect(board.slideDestination({ col: 0, row: 5 }, 'E', new Set(), 'red')).toEqual({ col: 5, row: 15 }); // entered heading E, exits S
    expect(board.slideDestination({ col: 5, row: 0 }, 'S', new Set(), 'red')).toEqual({ col: 15, row: 5 }); // entered heading S, exits E
    expect(board.slideDestination({ col: 5, row: 15 }, 'N', new Set(), 'red')).toEqual({ col: 0, row: 5 }); // entered heading N, exits W
    expect(board.slideDestination({ col: 15, row: 5 }, 'W', new Set(), 'red')).toEqual({ col: 5, row: 0 }); // entered heading W, exits N
  });

  it('a "/" deflector turns a mismatched-color robot: E->N, N->E, S->W, W->S', () => {
    const board = boardWith('/');
    expect(board.slideDestination({ col: 0, row: 5 }, 'E', new Set(), 'red')).toEqual({ col: 5, row: 0 }); // entered heading E, exits N
    expect(board.slideDestination({ col: 5, row: 0 }, 'S', new Set(), 'red')).toEqual({ col: 0, row: 5 }); // entered heading S, exits W
    expect(board.slideDestination({ col: 5, row: 15 }, 'N', new Set(), 'red')).toEqual({ col: 15, row: 5 }); // entered heading N, exits E
    expect(board.slideDestination({ col: 15, row: 5 }, 'W', new Set(), 'red')).toEqual({ col: 5, row: 15 }); // entered heading W, exits S
  });

  it('chains through two deflectors in a single slide', () => {
    // (5,5) '\' turns an eastbound robot south; (5,10) '/' then turns that
    // southbound robot west -- net result: enters heading E, exits heading W.
    const board = new Board(
      [],
      [
        { col: 5, row: 5, orientation: '\\', color: 'blue' },
        { col: 5, row: 10, orientation: '/', color: 'blue' },
      ],
    );
    const dest = board.slideDestination({ col: 0, row: 5 }, 'E', new Set(), 'red');
    expect(dest).toEqual({ col: 0, row: 10 });
  });

  it('terminates instead of looping forever around a closed 4-deflector loop', () => {
    // A rectangular loop -- (5,5)\ -> (5,8)/ -> (2,8)\ -> (2,5)/ -> back to
    // (5,5)\ heading the same way it did the first time -- would spin a
    // mismatched-color robot forever without the cycle guard. Entering at
    // (3,5) (between the two row-5 corners) reaches (5,5) heading E first,
    // so the loop is unambiguous. The guard breaks exactly when the state
    // (5,5, heading E) repeats, i.e. back at (5,5) itself.
    const board = new Board(
      [],
      [
        { col: 5, row: 5, orientation: '\\', color: 'blue' },
        { col: 5, row: 8, orientation: '/', color: 'blue' },
        { col: 2, row: 8, orientation: '\\', color: 'blue' },
        { col: 2, row: 5, orientation: '/', color: 'blue' },
      ],
    );
    const dest = board.slideDestination({ col: 3, row: 5 }, 'E', new Set(), 'red');
    expect(dest).toEqual({ col: 5, row: 5 });
  });
});

describe('Board.slidePath', () => {
  const classicBoard = new Board(buildBoardVariant('classic', FIXED_ASSIGNMENT).wallSegments);

  it('starts with the origin cell and ends where slideDestination says, on a plain slide', () => {
    const from = { col: 6, row: 3 };
    const path = classicBoard.slidePath(from, 'W', new Set(), 'red');
    expect(path[0]).toEqual(from);
    expect(path.at(-1)).toEqual(classicBoard.slideDestination(from, 'W', new Set(), 'red'));
    expect(path).toEqual([
      { col: 6, row: 3 },
      { col: 5, row: 3 },
      { col: 4, row: 3 },
      { col: 3, row: 3 },
      { col: 2, row: 3 },
      { col: 1, row: 3 },
      { col: 0, row: 3 },
    ]);
  });

  it('traces the exact bent route through a chain of deflectors, agreeing with slideDestination on the final cell', () => {
    const board = new Board(
      [],
      [
        { col: 5, row: 5, orientation: '\\', color: 'blue' },
        { col: 5, row: 10, orientation: '/', color: 'blue' },
      ],
    );
    const from = { col: 0, row: 5 };
    const path = board.slidePath(from, 'E', new Set(), 'red');
    expect(path).toEqual([
      { col: 0, row: 5 },
      { col: 1, row: 5 },
      { col: 2, row: 5 },
      { col: 3, row: 5 },
      { col: 4, row: 5 },
      { col: 5, row: 5 }, // deflector -- turns south here
      { col: 5, row: 6 },
      { col: 5, row: 7 },
      { col: 5, row: 8 },
      { col: 5, row: 9 },
      { col: 5, row: 10 }, // deflector -- turns west here
      { col: 4, row: 10 },
      { col: 3, row: 10 },
      { col: 2, row: 10 },
      { col: 1, row: 10 },
      { col: 0, row: 10 },
    ]);
    expect(path.at(-1)).toEqual(board.slideDestination(from, 'E', new Set(), 'red'));
  });

  it('is a single-element path when the robot cannot move at all', () => {
    const path = classicBoard.slidePath({ col: 0, row: 1 }, 'W', new Set(), 'red');
    expect(path).toEqual([{ col: 0, row: 1 }]);
  });
});

describe('rotateCellInBlock', () => {
  it('leaves a cell unchanged at 0 steps', () => {
    expect(rotateCellInBlock({ col: 2, row: 5 }, 0, 8)).toEqual({ col: 2, row: 5 });
  });

  it('rotates the four corners of an 8x8 block 90 degrees clockwise', () => {
    expect(rotateCellInBlock({ col: 0, row: 0 }, 1, 8)).toEqual({ col: 7, row: 0 });
    expect(rotateCellInBlock({ col: 7, row: 0 }, 1, 8)).toEqual({ col: 7, row: 7 });
    expect(rotateCellInBlock({ col: 7, row: 7 }, 1, 8)).toEqual({ col: 0, row: 7 });
    expect(rotateCellInBlock({ col: 0, row: 7 }, 1, 8)).toEqual({ col: 0, row: 0 });
  });

  it('180 degrees is the same as two 90-degree steps', () => {
    const cell = { col: 3, row: 1 };
    const twice = rotateCellInBlock(rotateCellInBlock(cell, 1, 8), 1, 8);
    expect(rotateCellInBlock(cell, 2, 8)).toEqual(twice);
  });

  it('4 steps returns to the start', () => {
    const cell = { col: 5, row: 2 };
    let result = cell;
    for (let i = 0; i < 4; i++) result = rotateCellInBlock(result, 1, 8);
    expect(result).toEqual(cell);
  });
});

describe('rotateDirection', () => {
  it('cycles N -> E -> S -> W -> N clockwise, one step at a time', () => {
    expect(rotateDirection('N', 1)).toBe('E');
    expect(rotateDirection('E', 1)).toBe('S');
    expect(rotateDirection('S', 1)).toBe('W');
    expect(rotateDirection('W', 1)).toBe('N');
  });

  it('2 steps reverses the direction', () => {
    expect(rotateDirection('N', 2)).toBe('S');
    expect(rotateDirection('E', 2)).toBe('W');
  });

  it('0 steps is a no-op', () => {
    expect(rotateDirection('N', 0)).toBe('N');
  });
});

describe('rotateDeflectorOrientation', () => {
  it('swaps orientation on an odd number of steps', () => {
    expect(rotateDeflectorOrientation('/', 1)).toBe('\\');
    expect(rotateDeflectorOrientation('\\', 1)).toBe('/');
    expect(rotateDeflectorOrientation('/', 3)).toBe('\\');
  });

  it('leaves orientation unchanged on an even number of steps', () => {
    expect(rotateDeflectorOrientation('/', 0)).toBe('/');
    expect(rotateDeflectorOrientation('/', 2)).toBe('/');
    expect(rotateDeflectorOrientation('\\', 2)).toBe('\\');
  });
});

describe('isStraightPath', () => {
  it('is true for a direct unbent slide', () => {
    const path = [
      { col: 0, row: 5 },
      { col: 1, row: 5 },
      { col: 2, row: 5 },
      { col: 3, row: 5 },
    ];
    expect(isStraightPath(path)).toBe(true);
  });

  it('is true for a single-cell (no-move) path', () => {
    expect(isStraightPath([{ col: 2, row: 2 }])).toBe(true);
  });

  it('is false once the path bends', () => {
    const path = [
      { col: 0, row: 5 },
      { col: 1, row: 5 },
      { col: 2, row: 5 }, // deflector here
      { col: 2, row: 6 },
      { col: 2, row: 7 },
    ];
    expect(isStraightPath(path)).toBe(false);
  });
});
