import { BOARD_SIZE, type Cell, type RobotColor, type WallSegment } from './Board';

/**
 * One hand-placed 16x16 classic-style layout: a walled-off center 2x2 vault
 * (no robot may ever enter it) plus one target per color, each given an
 * L-shaped wall on two adjacent edges -- the standard physical-tile design,
 * so a robot sliding along the target's row or column has a real stopping
 * point there from at least one direction.
 */

const VAULT_MIN = BOARD_SIZE / 2 - 1; // 7
const VAULT_MAX = BOARD_SIZE / 2; // 8

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

export interface Target {
  color: RobotColor;
  cell: Cell;
}

export const TARGETS: readonly Target[] = [
  { color: 'red', cell: { col: 3, row: 3 } },
  { color: 'blue', cell: { col: 12, row: 3 } },
  { color: 'green', cell: { col: 3, row: 12 } },
  { color: 'yellow', cell: { col: 12, row: 12 } },
];

const targetWalls: WallSegment[] = [
  { col: 3, row: 3, dir: 'S' },
  { col: 3, row: 3, dir: 'E' },
  { col: 12, row: 3, dir: 'S' },
  { col: 12, row: 3, dir: 'W' },
  { col: 3, row: 12, dir: 'N' },
  { col: 3, row: 12, dir: 'E' },
  { col: 12, row: 12, dir: 'N' },
  { col: 12, row: 12, dir: 'W' },
];

export const WALL_SEGMENTS: readonly WallSegment[] = [...vaultWalls, ...targetWalls];

export const VAULT_CELLS: readonly Cell[] = [
  { col: VAULT_MIN, row: VAULT_MIN },
  { col: VAULT_MAX, row: VAULT_MIN },
  { col: VAULT_MIN, row: VAULT_MAX },
  { col: VAULT_MAX, row: VAULT_MAX },
];

export const INITIAL_ROBOTS: Record<RobotColor, Cell> = {
  red: { col: 1, row: 1 },
  blue: { col: 14, row: 1 },
  green: { col: 1, row: 14 },
  yellow: { col: 14, row: 14 },
};
