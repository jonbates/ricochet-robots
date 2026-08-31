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

export type DeflectorOrientation = '/' | '\\';

export interface Deflector {
  col: number;
  row: number;
  orientation: DeflectorOrientation;
  color: RobotColor;
}

const DIR_DELTA: Record<Direction, { dc: number; dr: number }> = {
  N: { dc: 0, dr: -1 },
  S: { dc: 0, dr: 1 },
  E: { dc: 1, dr: 0 },
  W: { dc: -1, dr: 0 },
};

const DIR_BIT: Record<Direction, number> = { N: 1, E: 2, S: 4, W: 8 };
const OPPOSITE: Record<Direction, Direction> = { N: 'S', S: 'N', E: 'W', W: 'E' };

// Mirror-reflection table: how a deflector of a given orientation turns a
// robot entering it in a given direction. `\` reflects like a backslash
// mirror (E<->S, N<->W); `/` reflects like a forward-slash mirror (E<->N,
// S<->W).
const REFLECT: Record<DeflectorOrientation, Record<Direction, Direction>> = {
  '\\': { E: 'S', S: 'E', N: 'W', W: 'N' },
  '/': { E: 'N', N: 'E', S: 'W', W: 'S' },
};

export function cellKey(col: number, row: number): string {
  return `${col},${row}`;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row;
}

/** A count of 90-degree clockwise turns (0-3) -- used to place a quadrant tile, authored once in a canonical orientation, into any of the board's 4 corners. */
export type RotationSteps = 0 | 1 | 2 | 3;

/** Rotates a cell 90 degrees clockwise `steps` times within a square block of the given size (e.g. an 8x8 quadrant tile authored in local 0-7 coordinates). */
export function rotateCellInBlock(cell: Cell, steps: RotationSteps, blockSize: number): Cell {
  let { col, row } = cell;
  for (let i = 0; i < steps; i++) {
    const nextCol = blockSize - 1 - row;
    const nextRow = col;
    col = nextCol;
    row = nextRow;
  }
  return { col, row };
}

const ROTATE_DIR_CW: Record<Direction, Direction> = { N: 'E', E: 'S', S: 'W', W: 'N' };

export function rotateDirection(dir: Direction, steps: RotationSteps): Direction {
  let d = dir;
  for (let i = 0; i < steps; i++) d = ROTATE_DIR_CW[d];
  return d;
}

/** A 90 or 270 degree turn swaps '/' and '\\' (a diagonal line rotated a quarter-turn becomes the other diagonal); a 180 degree turn leaves either alone. */
export function rotateDeflectorOrientation(orientation: DeflectorOrientation, steps: RotationSteps): DeflectorOrientation {
  if (steps % 2 === 0) return orientation;
  return orientation === '/' ? '\\' : '/';
}

/**
 * True if a cell-by-cell path (as returned by Board.slidePath) never changes
 * direction -- i.e. a robot could have reached the last cell from the first
 * with one uninterrupted straight slide. Used to detect (and disallow) a
 * "trivial" solve where the target robot was already lined up for a direct
 * shot with no ricochet at all, per the real rule: a valid solution must
 * involve at least one direction change on the target robot's way to the
 * target -- if it could move there directly, that route doesn't count.
 */
export function isStraightPath(path: readonly Cell[]): boolean {
  if (path.length < 2) return true;
  const dc = Math.sign(path[1].col - path[0].col);
  const dr = Math.sign(path[1].row - path[0].row);
  for (let i = 1; i < path.length - 1; i++) {
    if (Math.sign(path[i + 1].col - path[i].col) !== dc || Math.sign(path[i + 1].row - path[i].row) !== dr) {
      return false;
    }
  }
  return true;
}

/**
 * A fixed grid of walls (bitmask per cell) plus the slide-resolution algorithm
 * shared by live player moves and the AI solver's search -- keeping this in
 * one place means the two can never disagree about how a robot moves.
 */
export class Board {
  private readonly wallGrid: Uint8Array;
  private readonly deflectors: Map<string, Deflector>;

  constructor(wallSegments: readonly WallSegment[], deflectors: readonly Deflector[] = []) {
    this.wallGrid = new Uint8Array(BOARD_SIZE * BOARD_SIZE);
    for (const seg of wallSegments) this.addWall(seg.col, seg.row, seg.dir);
    this.deflectors = new Map(deflectors.map((d) => [cellKey(d.col, d.row), d]));
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

  getDeflector(col: number, row: number): Deflector | undefined {
    return this.deflectors.get(cellKey(col, row));
  }

  getAllDeflectors(): readonly Deflector[] {
    return [...this.deflectors.values()];
  }

  /**
   * Where a robot at `from` ends up sliding `direction`, stopped by a wall,
   * the board edge, or an occupied cell. A deflector of a different color
   * than `movingColor` turns the slide 90 degrees instead of stopping it
   * (mirror physics, see REFLECT); a same-color deflector is a no-op, same
   * as an empty cell. Returns `from` unchanged if it can't move at all.
   */
  slideDestination(from: Cell, direction: Direction, occupied: ReadonlySet<string>, movingColor: RobotColor): Cell {
    let col = from.col;
    let row = from.row;
    let dir = direction;
    const seenDeflections = new Set<string>();

    while (!this.hasWall(col, row, dir)) {
      const { dc, dr } = DIR_DELTA[dir];
      const nCol = col + dc;
      const nRow = row + dr;
      if (!this.inBounds(nCol, nRow)) break;
      if (occupied.has(cellKey(nCol, nRow))) break;
      col = nCol;
      row = nRow;

      const deflector = this.getDeflector(col, row);
      if (deflector && deflector.color !== movingColor) {
        dir = REFLECT[deflector.orientation][dir];
        const state = `${col},${row},${dir}`;
        if (seenDeflections.has(state)) break; // cycling between facing deflectors -- stop rather than loop forever
        seenDeflections.add(state);
      }
    }
    return { col, row };
  }

  /**
   * Same slide as slideDestination(), but returns every cell visited along
   * the way (starting cell first, resting cell last) instead of just the
   * final position -- for tracing a move's path on the board (a deflector
   * can bend it, so the endpoints alone don't describe the route). Kept as
   * a separate twin of slideDestination() rather than having that method
   * build this list itself, since slideDestination() is the solver's hot
   * path (called per candidate move in the search) and this only runs once
   * per move when visualizing an already-found solution -- Board.test.ts
   * checks the two never disagree on the final cell.
   */
  slidePath(from: Cell, direction: Direction, occupied: ReadonlySet<string>, movingColor: RobotColor): Cell[] {
    const path: Cell[] = [{ col: from.col, row: from.row }];
    let col = from.col;
    let row = from.row;
    let dir = direction;
    const seenDeflections = new Set<string>();

    while (!this.hasWall(col, row, dir)) {
      const { dc, dr } = DIR_DELTA[dir];
      const nCol = col + dc;
      const nRow = row + dr;
      if (!this.inBounds(nCol, nRow)) break;
      if (occupied.has(cellKey(nCol, nRow))) break;
      col = nCol;
      row = nRow;
      path.push({ col, row });

      const deflector = this.getDeflector(col, row);
      if (deflector && deflector.color !== movingColor) {
        dir = REFLECT[deflector.orientation][dir];
        const state = `${col},${row},${dir}`;
        if (seenDeflections.has(state)) break;
        seenDeflections.add(state);
      }
    }
    return path;
  }
}
