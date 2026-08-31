import { describe, expect, it } from 'vitest';
import { Board } from './Board';
import { WALL_SEGMENTS } from './BoardLayout';

describe('Board.slideDestination', () => {
  const board = new Board(WALL_SEGMENTS);

  it('slides across an open lane all the way to the board edge', () => {
    const dest = board.slideDestination({ col: 5, row: 5 }, 'W', new Set());
    expect(dest).toEqual({ col: 0, row: 5 });
  });

  it('cannot move past an edge it is already resting on', () => {
    const dest = board.slideDestination({ col: 0, row: 5 }, 'W', new Set());
    expect(dest).toEqual({ col: 0, row: 5 });
  });

  it('stops at the red target cell approaching from the north (its S wall)', () => {
    const dest = board.slideDestination({ col: 3, row: 0 }, 'S', new Set());
    expect(dest).toEqual({ col: 3, row: 3 });
  });

  it('stops at the red target cell approaching from the west (its E wall)', () => {
    const dest = board.slideDestination({ col: 0, row: 3 }, 'E', new Set());
    expect(dest).toEqual({ col: 3, row: 3 });
  });

  it('does not stop at the red target approaching from the south -- the S wall blocks entry from that side', () => {
    const dest = board.slideDestination({ col: 3, row: 10 }, 'N', new Set());
    expect(dest).toEqual({ col: 3, row: 4 });
  });

  it('stops one cell short of another robot instead of at the wall/edge beyond it', () => {
    const occupied = new Set(['0,5']);
    const dest = board.slideDestination({ col: 0, row: 0 }, 'S', occupied);
    expect(dest).toEqual({ col: 0, row: 4 });
  });

  it('never lets a robot enter the center vault from any side', () => {
    expect(board.slideDestination({ col: 0, row: 7 }, 'E', new Set())).toEqual({ col: 6, row: 7 });
    expect(board.slideDestination({ col: 15, row: 8 }, 'W', new Set())).toEqual({ col: 9, row: 8 });
    expect(board.slideDestination({ col: 7, row: 0 }, 'S', new Set())).toEqual({ col: 7, row: 6 });
    expect(board.slideDestination({ col: 8, row: 15 }, 'N', new Set())).toEqual({ col: 8, row: 9 });
  });
});
