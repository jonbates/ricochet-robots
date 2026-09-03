import { describe, expect, it } from 'vitest';
import { cellKey, ROBOT_COLORS } from './Board';
import {
  buildBoardVariant,
  type BoardVariantId,
  INITIAL_ROBOTS,
  type QuadrantAssignment,
  randomInitialRobots,
  randomQuadrantAssignment,
  VAULT_CELLS,
} from './BoardLayout';

const VARIANT_IDS: readonly BoardVariantId[] = ['classic', 'diagonal'];

// Mirrors BoardLayout's own QUADRANT_FAMILIES -- a match always draws its 4
// corners from one family (A-D, E-H, or I-L), never mixing them, so
// exhaustive coverage means every permutation of each family separately
// rather than every permutation of all 12 tiles together.
const QUADRANT_FAMILIES: readonly (readonly number[])[] = [
  [0, 1, 2, 3],
  [4, 5, 6, 7],
  [8, 9, 10, 11],
];

function permutationsOf(tiles: readonly number[]): number[][] {
  const permutations: number[][] = [];
  const permute = (remaining: number[], chosen: number[]) => {
    if (remaining.length === 0) {
      permutations.push(chosen);
      return;
    }
    for (let i = 0; i < remaining.length; i++) {
      const next = [...remaining.slice(0, i), ...remaining.slice(i + 1)];
      permute(next, [...chosen, remaining[i]]);
    }
  };
  permute([...tiles], []);
  return permutations;
}

/** All 72 ways to assign 4 tiles to the 4 corners -- every arrangement the real random "snap together" setup could ever produce (24 permutations per family, across all 3 families), so the rotation math gets exhaustive coverage rather than just one fixed sample. */
function allQuadrantAssignments(): QuadrantAssignment[] {
  return QUADRANT_FAMILIES.flatMap((family) =>
    permutationsOf(family).map(([nw, ne, sw, se]) => ({ NW: nw, NE: ne, SW: sw, SE: se })),
  );
}

const ALL_ASSIGNMENTS = allQuadrantAssignments();

describe('BoardLayout quadrant assembly', () => {
  it('produces exactly 72 distinct corner assignments (24 permutations per family)', () => {
    expect(ALL_ASSIGNMENTS).toHaveLength(72);
    const keys = new Set(ALL_ASSIGNMENTS.map((a) => `${a.NW}${a.NE}${a.SW}${a.SE}`));
    expect(keys.size).toBe(72);
  });

  it.each(VARIANT_IDS)(
    'has no two targets, vault cells, or deflectors sharing a cell, for every possible quadrant arrangement (%s variant)',
    (variantId) => {
      for (const assignment of ALL_ASSIGNMENTS) {
        const variant = buildBoardVariant(variantId, assignment);
        const seen = new Map<string, string>();
        const claim = (col: number, row: number, label: string) => {
          const key = cellKey(col, row);
          const existing = seen.get(key);
          expect(
            existing,
            `assignment ${JSON.stringify(assignment)}: ${key} claimed by both "${existing}" and "${label}"`,
          ).toBeUndefined();
          seen.set(key, label);
        };

        for (const cell of VAULT_CELLS) claim(cell.col, cell.row, 'vault');
        for (const target of variant.targets) claim(target.cell.col, target.cell.row, `${target.color} target`);
        for (const deflector of variant.deflectors) claim(deflector.col, deflector.row, `${deflector.color} deflector`);
      }
    },
  );

  it.each(VARIANT_IDS)('has exactly 4 targets per robot color plus one warp target, all within the 16x16 board, for every arrangement (%s variant)', (variantId) => {
    for (const assignment of ALL_ASSIGNMENTS) {
      const variant = buildBoardVariant(variantId, assignment);
      const byColor = new Map<string, number>();
      for (const target of variant.targets) {
        byColor.set(target.color, (byColor.get(target.color) ?? 0) + 1);
        expect(target.cell.col).toBeGreaterThanOrEqual(0);
        expect(target.cell.col).toBeLessThan(16);
        expect(target.cell.row).toBeGreaterThanOrEqual(0);
        expect(target.cell.row).toBeLessThan(16);
      }
      expect(byColor.get('red')).toBe(4);
      expect(byColor.get('blue')).toBe(4);
      expect(byColor.get('green')).toBe(4);
      expect(byColor.get('yellow')).toBe(4);
      expect(byColor.get('warp')).toBe(1);
      expect(variant.targets.length).toBe(17);
    }
  });

  it.each(VARIANT_IDS)('gives each color exactly 4 distinct target shapes, for every arrangement (%s variant)', (variantId) => {
    for (const assignment of ALL_ASSIGNMENTS) {
      const variant = buildBoardVariant(variantId, assignment);
      for (const color of ['red', 'blue', 'green', 'yellow']) {
        const shapes = new Set(variant.targets.filter((t) => t.color === color).map((t) => t.shape));
        expect(shapes.size, `${color} targets should have 4 distinct shapes in assignment ${JSON.stringify(assignment)}`).toBe(4);
      }
    }
  });

  it('starts every robot outside the vault and off every target cell, for every arrangement and both variants', () => {
    const vaultKeys = new Set(VAULT_CELLS.map((c) => cellKey(c.col, c.row)));
    for (const variantId of VARIANT_IDS) {
      for (const assignment of ALL_ASSIGNMENTS) {
        const variant = buildBoardVariant(variantId, assignment);
        const targetKeys = new Set(variant.targets.map((t) => cellKey(t.cell.col, t.cell.row)));
        for (const start of Object.values(INITIAL_ROBOTS)) {
          const key = cellKey(start.col, start.row);
          expect(vaultKeys.has(key)).toBe(false);
          expect(targetKeys.has(key)).toBe(false);
        }
      }
    }
  });

  it('randomQuadrantAssignment always uses all 4 tiles of exactly one family, never mixing families', () => {
    const seenFamilies = new Set<number>();
    for (let i = 0; i < 90; i++) {
      const assignment = randomQuadrantAssignment();
      const used = [assignment.NW, assignment.NE, assignment.SW, assignment.SE].sort((a, b) => a - b);
      const matchedFamilyIndex = QUADRANT_FAMILIES.findIndex((family) => JSON.stringify(used) === JSON.stringify(family));
      expect(matchedFamilyIndex, `assignment ${JSON.stringify(assignment)} doesn't match any whole family`).toBeGreaterThanOrEqual(0);
      seenFamilies.add(matchedFamilyIndex);
    }
    expect(seenFamilies.size, 'expected 90 random assignments to have drawn from every family at least once').toBe(QUADRANT_FAMILIES.length);
  });
});

describe('randomInitialRobots', () => {
  const vaultKeys = new Set(VAULT_CELLS.map((c) => cellKey(c.col, c.row)));

  it('gives every robot color a cell, on the board, with no two robots sharing one', () => {
    for (let i = 0; i < 50; i++) {
      const robots = randomInitialRobots();
      const keys = ROBOT_COLORS.map((c) => cellKey(robots[c].col, robots[c].row));
      expect(new Set(keys).size).toBe(ROBOT_COLORS.length);
      for (const color of ROBOT_COLORS) {
        expect(robots[color].col).toBeGreaterThanOrEqual(0);
        expect(robots[color].col).toBeLessThan(16);
        expect(robots[color].row).toBeGreaterThanOrEqual(0);
        expect(robots[color].row).toBeLessThan(16);
      }
    }
  });

  it('never places a robot on a vault cell', () => {
    for (let i = 0; i < 50; i++) {
      const robots = randomInitialRobots();
      for (const color of ROBOT_COLORS) expect(vaultKeys.has(cellKey(robots[color].col, robots[color].row))).toBe(false);
    }
  });

  it('never places a robot on a cell passed via `exclude` -- e.g. the round\'s freshly-picked first target', () => {
    const variant = buildBoardVariant('classic', randomQuadrantAssignment());
    const target = variant.targets[0];
    for (let i = 0; i < 50; i++) {
      const robots = randomInitialRobots([target.cell]);
      for (const color of ROBOT_COLORS) expect(cellKey(robots[color].col, robots[color].row)).not.toBe(cellKey(target.cell.col, target.cell.row));
    }
  });
});
