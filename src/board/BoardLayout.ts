import {
  BOARD_SIZE,
  cellKey,
  type Cell,
  type Deflector,
  type DeflectorOrientation,
  type Direction,
  ROBOT_COLORS,
  rotateCellInBlock,
  rotateDeflectorOrientation,
  rotateDirection,
  type RobotColor,
  type RotationSteps,
  type WallSegment,
} from './Board';

/**
 * A 16x16 board assembled from 4 quadrant tiles snapped into the board's
 * corners, mirroring the real game's physical double-sided quadrant
 * sections: each match randomly picks which of the 4 tiles goes in which
 * corner (see randomQuadrantAssignment/buildBoardVariant). Every tile is
 * authored once, in a canonical orientation, then rotated to fit whichever
 * corner it lands in so its "inner" local corner always faces the shared
 * center vault, exactly like a physical tile is turned to point its
 * recessed corner toward the centerpiece.
 *
 * The wall-only "classic" board and the deflector-equipped "diagonal" board
 * share the same tiles and target layout -- the diagonal variant just also
 * places each tile's deflector cells (its "other side").
 */

const QUADRANT_SIZE = 8;
const VAULT_MIN = BOARD_SIZE / 2 - 1; // 7
const VAULT_MAX = BOARD_SIZE / 2; // 8

export const VAULT_CELLS: readonly Cell[] = [
  { col: VAULT_MIN, row: VAULT_MIN },
  { col: VAULT_MAX, row: VAULT_MIN },
  { col: VAULT_MIN, row: VAULT_MAX },
  { col: VAULT_MAX, row: VAULT_MAX },
];

const vaultWalls: WallSegment[] = [
  { col: VAULT_MIN, row: VAULT_MIN, dir: 'N' },
  { col: VAULT_MIN, row: VAULT_MIN, dir: 'W' },
  { col: VAULT_MAX, row: VAULT_MIN, dir: 'N' },
  { col: VAULT_MAX, row: VAULT_MIN, dir: 'E' },
  { col: VAULT_MIN, row: VAULT_MAX, dir: 'S' },
  { col: VAULT_MIN, row: VAULT_MAX, dir: 'W' },
  { col: VAULT_MAX, row: VAULT_MAX, dir: 'S' },
  { col: VAULT_MAX, row: VAULT_MAX, dir: 'E' },
];

/** A target's color is normally one of the 4 robot colors; 'warp' is a wildcard any robot can complete. */
export type TargetColor = RobotColor | 'warp';

/** Each color's 4 targets (one per quadrant tile) get a distinct shape so they stay visually distinguishable from each other even sharing a color; 'swirl' is reserved for the warp target. */
export type TargetShape = 'star' | 'square' | 'triangle' | 'diamond' | 'swirl';

export interface Target {
  color: TargetColor;
  cell: Cell;
  shape: TargetShape;
}

// Each target sits in the corner of an L-shaped wall pair, the standard
// physical-tile design -- a robot sliding along the target's row or column
// from the "closed" side has a real stopping point there.
type Corner = 'NE' | 'SE' | 'SW' | 'NW';
const CORNER_DIRS: Record<Corner, readonly [Direction, Direction]> = {
  NE: ['N', 'E'],
  SE: ['S', 'E'],
  SW: ['S', 'W'],
  NW: ['N', 'W'],
};

interface TargetSpec {
  color: RobotColor;
  cell: Cell; // local to the tile's own 8x8 space (0-7)
  corner: Corner;
  shape: TargetShape;
}

interface DeflectorSpec {
  col: number; // local to the tile's own 8x8 space (0-7)
  row: number;
  orientation: DeflectorOrientation;
  color: RobotColor;
}

interface EdgeBarrier {
  col: number; // local to the tile's own 8x8 space -- always on local row/col 0, the tile's two outer edges (the ones facing the true board boundary, not the vault), so it lands on a real outer edge of the board regardless of which corner the tile is rotated into
  row: number;
  dir: Direction;
}

interface QuadrantTile {
  id: string;
  /** Exactly one target per robot color, authored in this tile's own local 0-7 coordinates, with local (7,*) / (*,7) left clear -- that edge is the one that ends up facing the shared center vault once placed. */
  targets: readonly TargetSpec[];
  /** This tile's "diagonal" face -- only placed when the diagonal board variant is selected. */
  deflectors: readonly DeflectorSpec[];
  /** A lone wall face on the board's outer boundary, unrelated to any target -- present on at most a couple of tiles total, matching how sparingly the real board uses them. */
  edgeBarrier?: EdgeBarrier;
}

// 4 canonical tiles, each carrying one target per color (so any arrangement
// of all 4 -- which corner each lands in -- still gives the real game's 4
// targets per color). Target cells and their L-wall corners are lifted
// directly from a real physical board's 4 quadrants (photo reference:
// opinionatedgamers.com's Ricochet Robots review), each de-rotated back to
// this tile's own canonical NW-style orientation (inner corner at local
// (7,7)) the same way buildBoardVariant rotates a canonical tile back out
// into whichever corner it's placed -- see CORNER_BASE_STEPS below for the
// exact per-corner step counts this reverses. Shapes are assigned per-tile
// (all of tile A's targets are stars, tile B's are squares, etc.) so a
// color's 4 targets always end up with 4 different shapes -- the source
// photo's actual icon art isn't reproduced, only its target positions and
// walls. Local (6,6) is deliberately left clear on every tile -- under the
// NW placement (the only corner whose region reaches that cell) it would
// otherwise collide with the fixed warp target at global (6,6). Local (1,1)
// is also left clear on every tile -- it's the one local cell that lands
// exactly on that corner's starting robot regardless of which corner the
// tile is rotated into (a tile's local (0,0) is always its own outer board
// corner, and INITIAL_ROBOTS sits one cell in from every board corner); the
// source photo's own quadrant-D-derived tile actually had a target sitting
// exactly there, nudged one cell over to (2,1) to keep that guarantee.
// Two deflectors (tiles A and C, diagonal-variant only) also got nudged off
// their photo-adjacent cells, which the repositioned targets now occupy.
// Each tile carries only 2 deflectors (not one per target) and at most one
// tile carries a lone edgeBarrier -- both trimmed down from a denser first
// pass, to keep the diagonal board's obstacle count closer to the physical
// game's.
const QUADRANT_TILES: readonly QuadrantTile[] = [
  {
    id: 'A',
    targets: [
      { color: 'red', cell: { col: 3, row: 6 }, corner: 'SW', shape: 'star' },
      { color: 'blue', cell: { col: 6, row: 5 }, corner: 'NE', shape: 'star' },
      { color: 'green', cell: { col: 1, row: 2 }, corner: 'NW', shape: 'star' },
      { color: 'yellow', cell: { col: 6, row: 1 }, corner: 'SE', shape: 'star' },
    ],
    deflectors: [
      { col: 3, row: 0, orientation: '\\', color: 'blue' },
      { col: 0, row: 3, orientation: '/', color: 'green' },
    ],
    edgeBarrier: { col: 2, row: 0, dir: 'E' },
  },
  {
    id: 'B',
    targets: [
      { color: 'green', cell: { col: 1, row: 6 }, corner: 'SE', shape: 'square' },
      { color: 'yellow', cell: { col: 2, row: 1 }, corner: 'NW', shape: 'square' },
      { color: 'red', cell: { col: 4, row: 5 }, corner: 'NE', shape: 'square' },
      { color: 'blue', cell: { col: 6, row: 3 }, corner: 'SW', shape: 'square' },
    ],
    deflectors: [
      { col: 4, row: 0, orientation: '/', color: 'yellow' },
      { col: 0, row: 4, orientation: '\\', color: 'red' },
    ],
  },
  {
    id: 'C',
    targets: [
      { color: 'yellow', cell: { col: 6, row: 4 }, corner: 'NW', shape: 'triangle' },
      { color: 'blue', cell: { col: 5, row: 6 }, corner: 'NE', shape: 'triangle' },
      { color: 'red', cell: { col: 2, row: 1 }, corner: 'SE', shape: 'triangle' },
      { color: 'green', cell: { col: 1, row: 3 }, corner: 'SW', shape: 'triangle' },
    ],
    deflectors: [
      { col: 4, row: 1, orientation: '\\', color: 'yellow' },
      { col: 1, row: 4, orientation: '/', color: 'green' },
    ],
    edgeBarrier: { col: 0, row: 5, dir: 'N' },
  },
  {
    id: 'D',
    targets: [
      { color: 'yellow', cell: { col: 7, row: 5 }, corner: 'NW', shape: 'diamond' },
      { color: 'blue', cell: { col: 2, row: 4 }, corner: 'SE', shape: 'diamond' },
      { color: 'green', cell: { col: 6, row: 2 }, corner: 'NE', shape: 'diamond' },
      { color: 'red', cell: { col: 2, row: 1 }, corner: 'SW', shape: 'diamond' },
    ],
    deflectors: [
      { col: 4, row: 0, orientation: '\\', color: 'red' },
      { col: 0, row: 4, orientation: '/', color: 'blue' },
    ],
  },
];

// The wildcard target -- any robot (not just a matching color) completes it.
// Fixed at the board level (not tied to any one quadrant tile) just outside
// the vault's northwest corner.
const WARP_CORNER: Corner = 'SE';
export const WARP_TARGET: Target = { color: 'warp', cell: { col: 6, row: 6 }, shape: 'swirl' };
const warpWalls: WallSegment[] = CORNER_DIRS[WARP_CORNER].map((dir) => ({
  col: WARP_TARGET.cell.col,
  row: WARP_TARGET.cell.row,
  dir,
}));

type CornerId = 'NW' | 'NE' | 'SW' | 'SE';
const CORNER_OFFSET: Record<CornerId, Cell> = {
  NW: { col: 0, row: 0 },
  NE: { col: QUADRANT_SIZE, row: 0 },
  SW: { col: 0, row: QUADRANT_SIZE },
  SE: { col: QUADRANT_SIZE, row: QUADRANT_SIZE },
};
// How many 90-degree clockwise turns a tile (authored with its inner corner
// at local (7,7), as if it were the NW quadrant) needs to instead face that
// same inner corner toward the vault from each of the other 3 corners.
const CORNER_BASE_STEPS: Record<CornerId, RotationSteps> = { NW: 0, NE: 1, SW: 3, SE: 2 };

function placeLocalCell(local: Cell, corner: CornerId): Cell {
  const rotated = rotateCellInBlock(local, CORNER_BASE_STEPS[corner], QUADRANT_SIZE);
  const offset = CORNER_OFFSET[corner];
  return { col: rotated.col + offset.col, row: rotated.row + offset.row };
}

/**
 * A fixed reference layout (the board's 4 corners) -- not what a live match
 * actually starts from (see randomInitialRobots for that); this exists so
 * tests have one reproducible, hand-verifiable starting position to reason
 * about and to regression-check solvability against.
 */
export const INITIAL_ROBOTS: Record<RobotColor, Cell> = {
  red: { col: 1, row: 1 },
  blue: { col: 14, row: 1 },
  green: { col: 1, row: 14 },
  yellow: { col: 14, row: 14 },
};

/**
 * A random, mutually-distinct cell for each robot, avoiding the vault and
 * any cell in `exclude` (a match passes the freshly-picked first target's
 * cell, so the round doesn't start already solved). Used only once, for a
 * match's very first round -- every round after that carries over wherever
 * the robots ended up (see GameState.startNextRound), matching the real
 * game's evolving board. The physical game doesn't fix robots to the
 * corners for that first setup either: players place them freely on the
 * board before the first target is revealed.
 */
export function randomInitialRobots(exclude: readonly Cell[] = []): Record<RobotColor, Cell> {
  const taken = new Set(VAULT_CELLS.map((c) => cellKey(c.col, c.row)));
  for (const cell of exclude) taken.add(cellKey(cell.col, cell.row));

  const positions = {} as Record<RobotColor, Cell>;
  for (const color of ROBOT_COLORS) {
    let cell: Cell;
    do {
      cell = { col: Math.floor(Math.random() * BOARD_SIZE), row: Math.floor(Math.random() * BOARD_SIZE) };
    } while (taken.has(cellKey(cell.col, cell.row)));
    positions[color] = cell;
    taken.add(cellKey(cell.col, cell.row));
  }
  return positions;
}

export type BoardVariantId = 'classic' | 'diagonal';

export interface BoardVariant {
  wallSegments: readonly WallSegment[];
  deflectors: readonly Deflector[];
  targets: readonly Target[];
}

/** Which of the 4 QUADRANT_TILES (by index) sits in each board corner for one match. */
export interface QuadrantAssignment {
  NW: number;
  NE: number;
  SW: number;
  SE: number;
}

/** A random permutation of all 4 tiles across the 4 corners -- matches the real game's "shuffle the sections and snap them together" setup. */
export function randomQuadrantAssignment(): QuadrantAssignment {
  const order = QUADRANT_TILES.map((_, i) => i);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  const [nw, ne, sw, se] = order;
  return { NW: nw, NE: ne, SW: sw, SE: se };
}

/**
 * Assembles a full board from a quadrant assignment. `assignment` defaults
 * to a fresh random one (the normal case -- a new match snaps the 4 tiles
 * together randomly); tests pass a fixed assignment for reproducibility.
 */
export function buildBoardVariant(variantId: BoardVariantId, assignment: QuadrantAssignment = randomQuadrantAssignment()): BoardVariant {
  const wallSegments: WallSegment[] = [...vaultWalls, ...warpWalls];
  const targets: Target[] = [WARP_TARGET];
  const deflectors: Deflector[] = [];

  for (const corner of Object.keys(assignment) as CornerId[]) {
    const tile = QUADRANT_TILES[assignment[corner]];
    const steps = CORNER_BASE_STEPS[corner];

    for (const spec of tile.targets) {
      const cell = placeLocalCell(spec.cell, corner);
      targets.push({ color: spec.color, cell, shape: spec.shape });
      for (const dir of CORNER_DIRS[spec.corner]) {
        wallSegments.push({ col: cell.col, row: cell.row, dir: rotateDirection(dir, steps) });
      }
    }

    if (tile.edgeBarrier) {
      const cell = placeLocalCell({ col: tile.edgeBarrier.col, row: tile.edgeBarrier.row }, corner);
      wallSegments.push({ col: cell.col, row: cell.row, dir: rotateDirection(tile.edgeBarrier.dir, steps) });
    }

    if (variantId === 'diagonal') {
      for (const spec of tile.deflectors) {
        const cell = placeLocalCell({ col: spec.col, row: spec.row }, corner);
        deflectors.push({
          col: cell.col,
          row: cell.row,
          orientation: rotateDeflectorOrientation(spec.orientation, steps),
          color: spec.color,
        });
      }
    }
  }

  return { wallSegments, deflectors, targets };
}
