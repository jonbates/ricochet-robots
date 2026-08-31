export const BOARD_SIZE = 16;

export type Direction = 'N' | 'E' | 'S' | 'W';
export type RobotColor = 'red' | 'blue' | 'green' | 'yellow';

export const ROBOT_COLORS: readonly RobotColor[] = ['red', 'blue', 'green', 'yellow'];
export const ALL_DIRECTIONS: readonly Direction[] = ['N', 'E', 'S', 'W'];

export interface Cell {
  col: number;
  row: number;
}

export interface WallSegment {
  col: number;
  row: number;
  dir: Direction;
}

const DIR_DELTA: Record<Direction, { dc: number; dr: number }> = {
  N: { dc: 0, dr: -1 },
  S: { dc: 0, dr: 1 },
  E: { dc: 1, dr: 0 },
  W: { dc: -1, dr: 0 },
};

const DIR_BIT: Record<Direction, number> = { N: 1, E: 2, S: 4, W: 8 };
const OPPOSITE: Record<Direction, Direction> = { N: 'S', S: 'N', E: 'W', W: 'E' };

export function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row;
}

/**
 * A fixed grid of walls (bitmask per cell) plus the slide-resolution algorithm
 * shared by live player moves and the AI solver's search -- keeping this in
 * one place means the two can never disagree about how a robot moves.
 */
export class Board {
  private readonly wallGrid: Uint8Array;

  constructor(wallSegments: readonly WallSegment[]) {
    this.wallGrid = new Uint8Array(BOARD_SIZE * BOARD_SIZE);
    for (const seg of wallSegments) this.addWall(seg.col, seg.row, seg.dir);
  }

  private index(col: number, row: number): number {
    return row * BOARD_SIZE + col;
  }

  private addWall(col: number, row: number, dir: Direction): void {
    this.wallGrid[this.index(col, row)] |= DIR_BIT[dir];
    const { dc, dr } = DIR_DELTA[dir];
    const nCol = col + dc;
    const nRow = row + dr;
    // Mirror onto the neighbor so a wall reads the same from either side --
    // a wall on this cell's board edge (no neighbor) is still fine to record
    // one-sided, the boundary itself is handled separately by inBounds().
    if (this.inBounds(nCol, nRow)) {
      this.wallGrid[this.index(nCol, nRow)] |= DIR_BIT[OPPOSITE[dir]];
    }
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < BOARD_SIZE && row >= 0 && row < BOARD_SIZE;
  }

  hasWall(col: number, row: number, dir: Direction): boolean {
    return (this.wallGrid[this.index(col, row)] & DIR_BIT[dir]) !== 0;
  }

  /** Where a robot at `from` ends up sliding `direction`, stopped by a wall, the board edge, or an occupied cell. Returns `from` unchanged if it can't move at all. */
  slideDestination(from: Cell, direction: Direction, occupied: ReadonlySet<string>): Cell {
    let col = from.col;
    let row = from.row;
    const { dc, dr } = DIR_DELTA[direction];
    while (!this.hasWall(col, row, direction)) {
      const nCol = col + dc;
      const nRow = row + dr;
      if (!this.inBounds(nCol, nRow)) break;
      if (occupied.has(cellKey(nCol, nRow))) break;
      col = nCol;
      row = nRow;
    }
    return { col, row };
  }
}
