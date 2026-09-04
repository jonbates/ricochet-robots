import { describe, expect, it, vi } from 'vitest';
import type { Group, Material, Mesh } from 'three';
import { Board, BOARD_SIZE, type Cell, cellKey, type RobotColor } from '../board/Board';
import { buildBoardVariant, type Target } from '../board/BoardLayout';
import type { RobotPositions } from '../game/GameState';
import { BoardRenderer } from './BoardRenderer';

// BoardRenderer builds only plain three.js data (Scene, geometries,
// materials) in its constructor -- no WebGLRenderer, and no canvas outside
// the move-trail labels -- so it can be exercised directly here, without
// Game.test.ts's WebGLRenderer/jsdom scaffolding.

// A fixed assignment rather than randomQuadrantAssignment(), so the target
// cells these tests pick out are the same on every run.
const ASSIGNMENT = { NW: 0, NE: 1, SW: 2, SE: 3 };

/** The private per-robot icon slot from buildRobots -- reached into the same way Game.test.ts reaches for boardRenderer.moveTrailGroup. */
interface TopIconState {
  container: Group;
  icon: Group | null;
  shownKey: string | null;
}

function makeRenderer(): { renderer: BoardRenderer; targets: readonly Target[] } {
  const variant = buildBoardVariant('classic', ASSIGNMENT);
  const board = new Board(variant.wallSegments, variant.deflectors);
  return { renderer: new BoardRenderer(board, variant.targets), targets: variant.targets };
}

function topIconState(renderer: BoardRenderer, color: RobotColor): TopIconState {
  return (renderer as unknown as { robotTopIcons: Record<RobotColor, TopIconState> }).robotTopIcons[color];
}

/** Puts the red robot on `cell` and parks the other three on cells no target sits on, so only red's icon slot is ever in play. */
function redAt(cell: Cell, targets: readonly Target[]): RobotPositions {
  const targetKeys = new Set(targets.map((t) => cellKey(t.cell.col, t.cell.row)));
  const spare: Cell[] = [];
  for (let row = 0; row < BOARD_SIZE && spare.length < 3; row++) {
    for (let col = 0; col < BOARD_SIZE && spare.length < 3; col++) {
      if (targetKeys.has(cellKey(col, row))) continue;
      if (col === cell.col && row === cell.row) continue;
      spare.push({ col, row });
    }
  }
  return { red: cell, blue: spare[0], green: spare[1], yellow: spare[2] };
}

/** A cell no target sits on -- the "robot is on a plain tile" case. */
function plainCell(targets: readonly Target[]): Cell {
  const targetKeys = new Set(targets.map((t) => cellKey(t.cell.col, t.cell.row)));
  for (let row = 0; row < BOARD_SIZE; row++) {
    for (let col = 0; col < BOARD_SIZE; col++) {
      if (!targetKeys.has(cellKey(col, row))) return { col, row };
    }
  }
  throw new Error('every cell has a target -- test board setup is degenerate');
}

describe('BoardRenderer on-target robot icons', () => {
  it('leaves the icon slot empty for a robot on a plain tile', () => {
    const { renderer, targets } = makeRenderer();
    renderer.setRobotPositions(redAt(plainCell(targets), targets));

    const state = topIconState(renderer, 'red');
    expect(state.icon).toBeNull();
    expect(state.container.children).toHaveLength(0);
  });

  it('shows the target’s icon on top of a robot parked on it', () => {
    const { renderer, targets } = makeRenderer();
    renderer.setRobotPositions(redAt(targets[0].cell, targets));

    const state = topIconState(renderer, 'red');
    expect(state.icon).not.toBeNull();
    expect(state.container.children).toEqual([state.icon]);
    expect(state.shownKey).toBe(cellKey(targets[0].cell.col, targets[0].cell.row));
  });

  // The case a simple on-target boolean would get wrong: the robot is on a
  // target before *and* after, so nothing rebuilds unless the slot is keyed
  // by which target it is -- leaving the first target's icon stranded on a
  // robot now sitting on a different one.
  it('swaps the icon when a robot moves from one target straight onto another', () => {
    const { renderer, targets } = makeRenderer();
    expect(cellKey(targets[0].cell.col, targets[0].cell.row)).not.toBe(cellKey(targets[1].cell.col, targets[1].cell.row));

    renderer.setRobotPositions(redAt(targets[0].cell, targets));
    const firstIcon = topIconState(renderer, 'red').icon;

    renderer.setRobotPositions(redAt(targets[1].cell, targets));
    const state = topIconState(renderer, 'red');

    expect(state.icon).not.toBeNull();
    expect(state.icon).not.toBe(firstIcon);
    expect(state.container.children).toEqual([state.icon]);
    expect(state.shownKey).toBe(cellKey(targets[1].cell.col, targets[1].cell.row));
  });

  it('clears the icon when the robot steps back off onto a plain tile', () => {
    const { renderer, targets } = makeRenderer();
    renderer.setRobotPositions(redAt(targets[0].cell, targets));
    renderer.setRobotPositions(redAt(plainCell(targets), targets));

    const state = topIconState(renderer, 'red');
    expect(state.icon).toBeNull();
    expect(state.shownKey).toBeNull();
    expect(state.container.children).toHaveLength(0);
  });

  // setRobotPositions runs for every robot on every state change, so a
  // rebuild that isn't gated on the cell actually changing would allocate
  // (and strand) fresh geometry on frames where nothing moved.
  it('keeps the same icon when the robot hasn’t changed cells', () => {
    const { renderer, targets } = makeRenderer();
    renderer.setRobotPositions(redAt(targets[0].cell, targets));
    const firstIcon = topIconState(renderer, 'red').icon;

    renderer.setRobotPositions(redAt(targets[0].cell, targets));
    renderer.setRobotPositions(redAt(targets[0].cell, targets));

    expect(topIconState(renderer, 'red').icon).toBe(firstIcon);
  });

  it('disposes the icon it replaces, rather than leaking it on every target hop', () => {
    const { renderer, targets } = makeRenderer();
    renderer.setRobotPositions(redAt(targets[0].cell, targets));

    const disposals: ReturnType<typeof vi.spyOn>[] = [];
    topIconState(renderer, 'red').icon?.traverse((obj) => {
      const mesh = obj as Mesh;
      if (!mesh.isMesh) return;
      disposals.push(vi.spyOn(mesh.geometry, 'dispose'));
      disposals.push(vi.spyOn(mesh.material as Material, 'dispose'));
    });
    expect(disposals.length).toBeGreaterThan(0);

    renderer.setRobotPositions(redAt(plainCell(targets), targets));

    for (const dispose of disposals) expect(dispose).toHaveBeenCalled();
  });
});
