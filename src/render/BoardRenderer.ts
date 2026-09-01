import * as THREE from 'three';
import { BOARD_SIZE, type Board, type Cell, ROBOT_COLORS, type RobotColor } from '../board/Board';
import { VAULT_CELLS } from '../board/BoardLayout';
import type { RobotPositions } from '../game/GameState';
import type { Target, TargetShape } from '../board/BoardLayout';
import { darkenHex, lightenHex, ROBOT_HEX, targetColorHex, WARP_SECONDARY_HEX } from '../colors';

const TILE_LIGHT = 0xeef2f6;
const TILE_DARK = 0xdbe3ea;
const WALL_COLOR = 0x2c3e50;
const VAULT_COLOR = 0x1a1a2e;

const TILE_TOP = 0; // world Y of the playable tile surface
const WALL_HEIGHT = 0.36;
const ROBOT_RADIUS = 0.32;
const ROBOT_HEIGHT = 0.4;
const ROBOT_SIDES = 24; // smooth circle -- that outline is reserved for robots; target icons use stars/squares/etc instead, so the two never look alike
const ROBOT_DOME_RADIUS = 0.18;
const ROBOT_DOME_DARKEN = 0.55; // how much darker than the body the top "dome" decal is
const ROBOT_RING_INNER = 0.36;
const ROBOT_RING_OUTER = 0.42;
const ROBOT_RING_LIGHTEN = 0.5; // how much lighter than the body the surrounding ring is
const ROBOT_RING_Y_WORLD = 0.025; // just above the target-icon rings, so a robot standing on a target still reads as a robot first
const WALL_THICKNESS = 0.08;
const DEFLECTOR_LENGTH = 1.1;
const DEFLECTOR_THICKNESS = 0.16;
const DEFLECTOR_HEIGHT = 0.08;

// col grows toward +x (east), row grows toward +z (south). A '\' diagonal
// runs from the cell's NW corner to its SE corner -- i.e. along the
// direction of increasing x and increasing z -- so a box whose long axis
// starts on +x needs a -45 degree turn around Y to align with it; '/' runs
// NE-to-SW (increasing x, decreasing z), the mirror image, +45 degrees.
const DEFLECTOR_ROTATION_Y: Record<'/' | '\\', number> = {
  '\\': -Math.PI / 4,
  '/': Math.PI / 4,
};

const ICON_Y = 0.015;
const ICON_RING_INNER = 0.3;
const ICON_RING_OUTER = 0.38;
const ICON_RING_Y_OFFSET = -0.003; // just under the icon shape, within the same group, to avoid z-fighting
const VAULT_ICON_Y = 0.13; // sits on top of the vault box (height 0.12)
const SOLUTION_PATH_Y = 0.09;
const SOLUTION_DASH_LENGTH = 0.16;
const SOLUTION_DASH_GAP = 0.12;
const SOLUTION_DASH_WIDTH = 0.05;
const SOLUTION_ARROW_LENGTH = 0.26;
const SOLUTION_ARROW_WIDTH = 0.22;
const SOLUTION_JITTER_STEP = 0.07; // sideways offset per move, so overlapping moves (a later one retracing an earlier one's cells) run side by side instead of exactly on top of each other
const SOLUTION_JITTER_CYCLE = 5; // offsets cycle through a small +/- range rather than drifting further apart with every extra move in a long solution
const TRAIL_LABEL_RADIUS = 0.32;
const TRAIL_LABEL_Y = 0.095; // just above the dash/arrow layer, so the number badge always draws on top

/** A flat, unlit shape geometry for a target icon -- square/diamond/triangle come "for free" out of a low-segment CircleGeometry with a chosen starting angle; the star and the warp target's swirl need real outlines. Deliberately no smooth-circle icon shape -- that outline is reserved for robots (see buildRobots), so a target is never visually confused with one. */
function buildIconGeometry(shape: TargetShape): THREE.BufferGeometry {
  switch (shape) {
    case 'star':
      return buildStarGeometry(0.3, 0.13, 5);
    case 'square':
      // 4-gon vertices land on the axes by default (a diamond); starting the
      // first vertex at 45 degrees instead lands them on the diagonals, i.e.
      // an axis-aligned square.
      return new THREE.CircleGeometry(0.24, 4, Math.PI / 4);
    case 'diamond':
      return new THREE.CircleGeometry(0.28, 4);
    case 'triangle':
      return new THREE.CircleGeometry(0.3, 3);
    case 'swirl':
      return buildSwirlGeometry(0.32, 1.6, 0.16, 40);
  }
}

/** A full five-pointed star outline, traced as one 10-vertex polygon alternating outer points and inner concave vertices. */
function buildStarGeometry(outerRadius: number, innerRadius: number, points: number): THREE.ShapeGeometry {
  const shape = new THREE.Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

/**
 * A filled spiral ribbon -- a circle swirling in on itself -- for the warp
 * target: a vortex reads more like "pulls you elsewhere" than a star does.
 * Traced as an Archimedean spiral (radius grows linearly with angle) with a
 * stroke that tapers from a point at the center out to `strokeWidth` at the
 * rim, built as a closed polygon (an outer edge traced outward, then the
 * inner edge traced back inward) since flat filled shapes are what render
 * reliably here -- see the dashed solution-path arrows below for the same
 * "fake width via a filled ribbon" approach applied to a straight line.
 * `phaseOffset` starts the spiral partway around instead of at angle 0 --
 * used to lay a second arm opposite the first (see buildIconMesh) without
 * the two coinciding.
 */
function buildSwirlGeometry(maxRadius: number, turns: number, strokeWidth: number, segments: number, phaseOffset = 0): THREE.ShapeGeometry {
  const outer: { x: number; y: number }[] = [];
  const inner: { x: number; y: number }[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const angle = phaseOffset + t * turns * Math.PI * 2;
    const r = t * maxRadius;
    const cx = Math.cos(angle) * r;
    const cy = Math.sin(angle) * r;
    const nx = Math.cos(angle + Math.PI / 2);
    const ny = Math.sin(angle + Math.PI / 2);
    const halfWidth = (strokeWidth / 2) * t; // tapers to a point at the center
    outer.push({ x: cx + nx * halfWidth, y: cy + ny * halfWidth });
    inner.push({ x: cx - nx * halfWidth, y: cy - ny * halfWidth });
  }
  const shape = new THREE.Shape();
  shape.moveTo(outer[0].x, outer[0].y);
  for (const p of outer.slice(1)) shape.lineTo(p.x, p.y);
  for (const p of inner.slice().reverse()) shape.lineTo(p.x, p.y);
  shape.closePath();
  return new THREE.ShapeGeometry(shape);
}

function disposeObject3D(obj: THREE.Object3D): void {
  obj.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      const material = child.material as THREE.Material & { map?: THREE.Texture | null };
      material.map?.dispose(); // numbered move-trail labels carry a canvas texture that needs its own disposal
      material.dispose();
    }
  });
}

/** A small canvas-drawn "(n)" badge -- solid circle in the move's own color, white ring, white number -- as a texture, since there's no 3D font loaded for real text geometry. Cheap enough to regenerate on every trail redraw (at most a couple dozen small canvases for a long attempt). */
function buildNumberLabelTexture(n: number, hexColor: number): THREE.CanvasTexture {
  const size = 128;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 4, 0, Math.PI * 2);
  ctx.fillStyle = `#${hexColor.toString(16).padStart(6, '0')}`;
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = '#ffffff';
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), size / 2, size / 2 + 4);
  return new THREE.CanvasTexture(canvas);
}

function buildNumberLabel(n: number, hexColor: number): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(TRAIL_LABEL_RADIUS, 24);
  const material = new THREE.MeshBasicMaterial({ map: buildNumberLabelTexture(n, hexColor), transparent: true });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  return mesh;
}

/** cell -> world-space (x,z) so col/row grow toward +x/+z, centered on the origin. */
function cellToWorld(cell: Cell): { x: number; z: number } {
  const half = (BOARD_SIZE - 1) / 2;
  return { x: cell.col - half, z: cell.row - half };
}

interface PathRun {
  a: { x: number; z: number };
  b: { x: number; z: number };
  dc: number; // -1, 0, or 1 -- the board-space direction of this run
  dr: number;
}

/** Splits a cell-by-cell path into straight runs -- a deflector bend starts a new run -- as world-space segments, so each run can be dashed independently and the move's very last run can carry the arrowhead. */
function splitPathIntoRuns(path: readonly Cell[]): PathRun[] {
  const runs: PathRun[] = [];
  let i = 0;
  while (i < path.length - 1) {
    const dc = Math.sign(path[i + 1].col - path[i].col);
    const dr = Math.sign(path[i + 1].row - path[i].row);
    let j = i + 1;
    while (j < path.length - 1 && Math.sign(path[j + 1].col - path[j].col) === dc && Math.sign(path[j + 1].row - path[j].row) === dr) {
      j++;
    }
    runs.push({ a: cellToWorld(path[i]), b: cellToWorld(path[j]), dc, dr });
    i = j;
  }
  return runs;
}

/**
 * Rotation.y that aims a shape authored pointing along local +X toward the
 * given axis-aligned board direction (dc, dr). Verified against Three.js's
 * actual rotateY convention the same way the deflector rotation above was:
 * rotateY(-45deg) takes local +X to world (+x,+z) i.e. increasing col AND
 * row -- so by the same formula, +x maps to east (0deg), +z to south
 * (-90deg), -x to west (180deg), -z to north (+90deg).
 */
function directionAngle(dc: number, dr: number): number {
  if (dc > 0) return 0;
  if (dr > 0) return -Math.PI / 2;
  if (dc < 0) return Math.PI;
  return Math.PI / 2;
}

/** A thin flat rectangle with vertices authored directly in the XZ plane (y=0 throughout) rather than the default XY -- so aiming it only ever needs a single rotation.y, with no rotation.x to first lay it flat and no risk of getting the two rotations' combined order wrong. Long axis along local +X, matching directionAngle(). */
function buildFlatRectGeometry(length: number, width: number): THREE.BufferGeometry {
  const hl = length / 2;
  const hw = width / 2;
  const positions = new Float32Array([-hl, 0, -hw, hl, 0, -hw, hl, 0, hw, -hl, 0, -hw, hl, 0, hw, -hl, 0, hw]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

/** A flat arrowhead triangle, apex at local +X -- see buildFlatRectGeometry for why it's authored directly in the XZ plane. */
function buildFlatArrowGeometry(length: number, width: number): THREE.BufferGeometry {
  const hw = width / 2;
  const positions = new Float32Array([0, 0, hw, 0, 0, -hw, length, 0, 0]);
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  return geometry;
}

/**
 * Owns the Three.js scene, the orthographic top-down camera, and every mesh
 * on the board. Static geometry (tiles, walls, vault) is built once from
 * BoardLayout; robot/target/selection meshes are repositioned each time
 * GameState changes rather than rebuilt.
 */
export class BoardRenderer {
  readonly scene = new THREE.Scene();
  readonly camera: THREE.OrthographicCamera;

  private readonly viewSize = BOARD_SIZE + 3; // grid extent plus a margin

  /** What fraction of the container's height the board itself actually occupies on screen -- the camera's vertical extent is always exactly `viewSize` regardless of container shape, so this ratio (times the container's pixel height) is the board's rendered pixel width too, since applyAspect keeps a uniform (non-stretching) scale. Lets callers (the HUD) align themselves with the board's real footprint instead of the container's, now that applyAspect no longer centers the board within a wider container. */
  readonly boardToViewRatio = BOARD_SIZE / this.viewSize;
  private readonly robotMeshes: Record<RobotColor, THREE.Mesh>;
  private readonly activeTargetHighlight: THREE.Mesh;
  private readonly selectionHighlight: THREE.Mesh;
  private readonly vaultIconGroup: THREE.Group;
  private vaultIconMesh: THREE.Group | null = null;
  private solutionPathGroup: THREE.Group | null = null;
  private moveTrailGroup: THREE.Group | null = null;

  constructor(board: Board, targets: readonly Target[]) {
    this.scene.background = new THREE.Color(0x0a1a2a);
    this.camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
    this.camera.position.set(0, 30, 0);
    // Looking straight down means the default up vector (0,1,0) is parallel
    // to the view direction, which leaves lookAt's orientation undefined --
    // an explicit -Z "up" is what actually makes row 0 (north) read as the
    // top of the screen.
    this.camera.up.set(0, 0, -1);
    this.camera.lookAt(0, 0, 0);
    this.applyAspect(1);

    this.buildLights();
    this.buildTiles();
    this.buildGridLines();
    this.buildVault();
    this.buildWalls(board);
    this.buildBoundaryFrame();
    this.buildDeflectors(board);

    this.robotMeshes = this.buildRobots();
    this.buildTargetIcons(targets);
    this.activeTargetHighlight = this.buildRing(0.36, 0.44, 0xffffff, 0.02);
    this.selectionHighlight = this.buildRing(0.38, 0.48, 0xffffff, 0.03);
    this.selectionHighlight.visible = false;
    this.vaultIconGroup = new THREE.Group();
    const { x: vaultX, z: vaultZ } = this.vaultCenter();
    this.vaultIconGroup.position.set(vaultX, 0, vaultZ);
    this.scene.add(this.vaultIconGroup);
  }

  private buildLights(): void {
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.75));
    const sun = new THREE.DirectionalLight(0xffffff, 0.6);
    sun.position.set(6, 12, 4);
    this.scene.add(sun);
  }

  private buildTiles(): void {
    const group = new THREE.Group();
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const geometry = new THREE.PlaneGeometry(1, 1);
        const color = (col + row) % 2 === 0 ? TILE_LIGHT : TILE_DARK;
        const material = new THREE.MeshStandardMaterial({ color, roughness: 0.9 });
        const mesh = new THREE.Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        const { x, z } = cellToWorld({ col, row });
        mesh.position.set(x, TILE_TOP, z);
        group.add(mesh);
      }
    }
    this.scene.add(group);
  }

  private buildGridLines(): void {
    const half = BOARD_SIZE / 2;
    const points: THREE.Vector3[] = [];
    for (let i = 0; i <= BOARD_SIZE; i++) {
      const offset = i - half;
      points.push(new THREE.Vector3(offset, 0.005, -half), new THREE.Vector3(offset, 0.005, half));
      points.push(new THREE.Vector3(-half, 0.005, offset), new THREE.Vector3(half, 0.005, offset));
    }
    const geometry = new THREE.BufferGeometry().setFromPoints(points);
    const material = new THREE.LineBasicMaterial({ color: 0xb9c4cf, transparent: true, opacity: 0.6 });
    this.scene.add(new THREE.LineSegments(geometry, material));
  }

  private vaultCenter(): { x: number; z: number } {
    const cols = VAULT_CELLS.map((c) => c.col);
    const rows = VAULT_CELLS.map((c) => c.row);
    const centerCol = (Math.min(...cols) + Math.max(...cols)) / 2;
    const centerRow = (Math.min(...rows) + Math.max(...rows)) / 2;
    return cellToWorld({ col: centerCol, row: centerRow });
  }

  private buildVault(): void {
    const cols = VAULT_CELLS.map((c) => c.col);
    const rows = VAULT_CELLS.map((c) => c.row);
    const width = Math.max(...cols) - Math.min(...cols) + 1;
    const depth = Math.max(...rows) - Math.min(...rows) + 1;
    const { x, z } = this.vaultCenter();

    const geometry = new THREE.BoxGeometry(width, 0.12, depth);
    const material = new THREE.MeshStandardMaterial({ color: VAULT_COLOR, roughness: 0.7 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, 0.06, z);
    this.scene.add(mesh);
  }

  /** Interior walls only -- the outer boundary gets its own frame in buildBoundaryFrame(). Each wall is authored symmetrically on both cells it separates, so only N/W bits are drawn to avoid drawing the same physical segment twice. */
  private buildWalls(board: Board): void {
    const group = new THREE.Group();
    const geometryNS = new THREE.BoxGeometry(1 + WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS);
    const geometryEW = new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, 1 + WALL_THICKNESS);
    const material = new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.6 });

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const { x, z } = cellToWorld({ col, row });
        if (board.hasWall(col, row, 'N')) {
          const mesh = new THREE.Mesh(geometryNS, material);
          mesh.position.set(x, WALL_HEIGHT / 2, z - 0.5);
          group.add(mesh);
        }
        if (board.hasWall(col, row, 'W')) {
          const mesh = new THREE.Mesh(geometryEW, material);
          mesh.position.set(x - 0.5, WALL_HEIGHT / 2, z);
          group.add(mesh);
        }
      }
    }
    this.scene.add(group);
  }

  private buildBoundaryFrame(): void {
    const half = BOARD_SIZE / 2;
    const material = new THREE.MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.6 });
    const long = new THREE.BoxGeometry(BOARD_SIZE + WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS);
    const north = new THREE.Mesh(long, material);
    north.position.set(0, WALL_HEIGHT / 2, -half);
    const south = new THREE.Mesh(long, material);
    south.position.set(0, WALL_HEIGHT / 2, half);
    const sideGeom = new THREE.BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, BOARD_SIZE + WALL_THICKNESS);
    const west = new THREE.Mesh(sideGeom, material);
    west.position.set(-half, WALL_HEIGHT / 2, 0);
    const east = new THREE.Mesh(sideGeom, material);
    east.position.set(half, WALL_HEIGHT / 2, 0);
    this.scene.add(north, south, west, east);
  }

  /** Diagonal bars for the diagonal board variant -- a no-op (empty list) for the classic variant, which has none. */
  private buildDeflectors(board: Board): void {
    const geometry = new THREE.BoxGeometry(DEFLECTOR_LENGTH, DEFLECTOR_HEIGHT, DEFLECTOR_THICKNESS);
    for (const deflector of board.getAllDeflectors()) {
      const material = new THREE.MeshStandardMaterial({ color: ROBOT_HEX[deflector.color], roughness: 0.4 });
      const mesh = new THREE.Mesh(geometry, material);
      const { x, z } = cellToWorld(deflector);
      mesh.position.set(x, DEFLECTOR_HEIGHT / 2, z);
      mesh.rotation.y = DEFLECTOR_ROTATION_Y[deflector.orientation];
      this.scene.add(mesh);
    }
  }

  /**
   * A true circular prism -- the smooth-circle outline is reserved for
   * robots specifically; target icons use star/square/diamond/triangle/
   * swirl instead (see buildIconGeometry), so a robot is never visually
   * confused with a same-colored target sitting on the same or an adjacent
   * cell. Flat/unlit body (MeshBasicMaterial) so its color renders
   * pixel-identical to the target icons, which are also unlit -- a lit
   * material picks up ambient/directional shading that made the robot read
   * as a visibly different (dimmer) shade of the same color. A smaller,
   * darker circular "dome" decal sits on top as a cheap top-down stand-in
   * for a rounded 3D robot body, and a lighter ring sits around its base on
   * the tile -- both opt out of raycasting so clicks still resolve to the
   * body mesh beneath them.
   */
  private buildRobots(): Record<RobotColor, THREE.Mesh> {
    const geometry = new THREE.CylinderGeometry(ROBOT_RADIUS, ROBOT_RADIUS, ROBOT_HEIGHT, ROBOT_SIDES);
    const domeGeometry = new THREE.CircleGeometry(ROBOT_DOME_RADIUS, 24);
    const ringGeometry = new THREE.RingGeometry(ROBOT_RING_INNER, ROBOT_RING_OUTER, 32);
    const out = {} as Record<RobotColor, THREE.Mesh>;
    for (const color of ROBOT_COLORS) {
      const material = new THREE.MeshBasicMaterial({ color: ROBOT_HEX[color] });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = ROBOT_HEIGHT / 2;

      const domeMaterial = new THREE.MeshBasicMaterial({ color: darkenHex(ROBOT_HEX[color], ROBOT_DOME_DARKEN) });
      const dome = new THREE.Mesh(domeGeometry, domeMaterial);
      dome.rotation.x = -Math.PI / 2;
      dome.position.y = ROBOT_HEIGHT / 2 + 0.001; // just above the body's own top face, in its local frame
      dome.raycast = () => {};
      mesh.add(dome);

      const ringMaterial = new THREE.MeshBasicMaterial({ color: lightenHex(ROBOT_HEX[color], ROBOT_RING_LIGHTEN), side: THREE.DoubleSide });
      const ring = new THREE.Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = ROBOT_RING_Y_WORLD - ROBOT_HEIGHT / 2; // local offset that lands the ring at world y = ROBOT_RING_Y_WORLD, on the tile around the body's base
      ring.raycast = () => {};
      mesh.add(ring);

      this.scene.add(mesh);
      out[color] = mesh;
    }
    return out;
  }

  /** One static icon per target, never moved again once built -- the active one is called out separately by repositioning activeTargetHighlight onto its cell in setTarget(). */
  private buildTargetIcons(targets: readonly Target[]): void {
    for (const target of targets) {
      const group = this.buildIconWithRing(target);
      const { x, z } = cellToWorld(target.cell);
      group.position.set(x, ICON_Y, z);
      this.scene.add(group);
    }
  }

  private buildIconMesh(target: Target): THREE.Object3D {
    if (target.shape === 'swirl') {
      // A second, thinner arm in a contrasting warm color (opposite the
      // primary purple arm, phase-shifted by half a turn) so the vortex
      // reads as two interleaved strands rather than one flat purple shape.
      const group = new THREE.Group();
      const primary = new THREE.Mesh(
        buildSwirlGeometry(0.32, 1.6, 0.16, 40),
        new THREE.MeshBasicMaterial({ color: targetColorHex(target.color), side: THREE.DoubleSide }),
      );
      const secondary = new THREE.Mesh(
        buildSwirlGeometry(0.32, 1.6, 0.14, 40, Math.PI),
        new THREE.MeshBasicMaterial({ color: WARP_SECONDARY_HEX, side: THREE.DoubleSide }),
      );
      primary.rotation.x = -Math.PI / 2;
      secondary.rotation.x = -Math.PI / 2;
      secondary.position.y = 0.001; // just above the primary arm, avoiding z-fighting where they'd otherwise coincide at the center
      group.add(primary, secondary);
      return group;
    }
    const geometry = buildIconGeometry(target.shape);
    const material = new THREE.MeshBasicMaterial({ color: targetColorHex(target.color), side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  /** An icon shape plus a ring in that same target color drawn around it -- shapes alone (especially the star vs. the round robots, or the swirl vs. a busy board) can be hard to tell apart at a glance, so the surrounding color ring gives an immediate "which robot" cue independent of the inner shape. */
  private buildIconWithRing(target: Target): THREE.Group {
    const group = new THREE.Group();
    const ringGeometry = new THREE.RingGeometry(ICON_RING_INNER, ICON_RING_OUTER, 32);
    const ringMaterial = new THREE.MeshBasicMaterial({ color: targetColorHex(target.color), side: THREE.DoubleSide });
    const ring = new THREE.Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = ICON_RING_Y_OFFSET;
    group.add(ring);
    group.add(this.buildIconMesh(target));
    return group;
  }

  private buildRing(innerRadius: number, outerRadius: number, color: number, y: number): THREE.Mesh {
    const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 32);
    const material = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    this.scene.add(mesh);
    return mesh;
  }

  setRobotPositions(robots: RobotPositions): void {
    for (const color of ROBOT_COLORS) {
      const { x, z } = cellToWorld(robots[color]);
      this.robotMeshes[color].position.x = x;
      this.robotMeshes[color].position.z = z;
    }
  }

  /** Moves the highlight ring onto whichever static target icon is now active, and refreshes the vault's reference-card copy of that same icon. */
  setTarget(target: Target): void {
    const { x, z } = cellToWorld(target.cell);
    this.activeTargetHighlight.position.x = x;
    this.activeTargetHighlight.position.z = z;

    if (this.vaultIconMesh) {
      this.vaultIconGroup.remove(this.vaultIconMesh);
      disposeObject3D(this.vaultIconMesh);
    }
    const group = this.buildIconWithRing(target);
    group.scale.setScalar(1.4); // bigger than the on-board icons -- it's a reference card, meant to be read at a glance
    group.position.y = VAULT_ICON_Y;
    this.vaultIconGroup.add(group);
    this.vaultIconMesh = group;
  }

  setSelected(color: RobotColor | null): void {
    if (!color) {
      this.selectionHighlight.visible = false;
      return;
    }
    this.selectionHighlight.visible = true;
    this.selectionHighlight.position.x = this.robotMeshes[color].position.x;
    this.selectionHighlight.position.z = this.robotMeshes[color].position.z;
  }

  /**
   * Draws each move as a dashed arrow in that move's robot color, tracing
   * its actual on-board path cell-by-cell (a deflector can bend it, so a
   * single move can have more than one straight run) -- dashes along the
   * way, one arrowhead at the very end pointing in the direction the robot
   * was traveling when it stopped, and (when `numbered`) a small "(n)"
   * badge at the move's starting cell, 1-indexed in move order. Flat
   * rectangles/triangles rather than a THREE.Line: WebGL ignores
   * line-width entirely, so a real line would always render at 1px
   * regardless of styling -- small filled meshes stay reliably visible
   * (and orientable) at any zoom. Shared by both the AI's revealed
   * solution and the live trail of moves a player has actually made this
   * attempt (see showSolutionPath / showMoveTrail below) -- numbering is
   * the only real difference between the two.
   */
  private drawDashedMoves(
    group: THREE.Group,
    moves: readonly { color: RobotColor; path: readonly Cell[] }[],
    numbered: boolean,
    lighten = 0,
  ): void {
    const dashGeometry = buildFlatRectGeometry(SOLUTION_DASH_LENGTH, SOLUTION_DASH_WIDTH);
    const arrowGeometry = buildFlatArrowGeometry(SOLUTION_ARROW_LENGTH, SOLUTION_ARROW_WIDTH);

    moves.forEach((move, moveIndex) => {
      const moveColor = lighten > 0 ? lightenHex(ROBOT_HEX[move.color], lighten) : ROBOT_HEX[move.color];
      const material = new THREE.MeshBasicMaterial({ color: moveColor, side: THREE.DoubleSide });
      const runs = splitPathIntoRuns(move.path);
      // A consistent per-move sideways offset, applied perpendicular to
      // whichever direction that move is running at each point -- so a
      // later move's dashes/arrow sit visibly beside an earlier move's
      // instead of exactly coincident, wherever their paths happen to cross
      // or retrace the same cells.
      const jitter = ((moveIndex % SOLUTION_JITTER_CYCLE) - Math.floor(SOLUTION_JITTER_CYCLE / 2)) * SOLUTION_JITTER_STEP;

      for (const run of runs) {
        const angle = directionAngle(run.dc, run.dr);
        const perpX = -run.dr * jitter;
        const perpZ = run.dc * jitter;
        const length = Math.hypot(run.b.x - run.a.x, run.b.z - run.a.z);
        const dashCount = Math.max(1, Math.round(length / (SOLUTION_DASH_LENGTH + SOLUTION_DASH_GAP)));
        for (let d = 0; d < dashCount; d++) {
          const t = (d + 0.5) / dashCount; // centers each dash within its own slot along the run
          const dash = new THREE.Mesh(dashGeometry, material);
          dash.position.set(run.a.x + (run.b.x - run.a.x) * t + perpX, SOLUTION_PATH_Y, run.a.z + (run.b.z - run.a.z) * t + perpZ);
          dash.rotation.y = angle;
          group.add(dash);
        }
      }

      const firstRun = runs[0];
      if (numbered && firstRun) {
        const perpX = -firstRun.dr * jitter;
        const perpZ = firstRun.dc * jitter;
        const label = buildNumberLabel(moveIndex + 1, moveColor);
        label.position.set(firstRun.a.x + perpX, TRAIL_LABEL_Y, firstRun.a.z + perpZ);
        group.add(label);
      }

      const lastRun = runs[runs.length - 1];
      if (lastRun) {
        const perpX = -lastRun.dr * jitter;
        const perpZ = lastRun.dc * jitter;
        const arrow = new THREE.Mesh(arrowGeometry, material);
        arrow.position.set(lastRun.b.x + perpX, SOLUTION_PATH_Y, lastRun.b.z + perpZ);
        arrow.rotation.y = directionAngle(lastRun.dc, lastRun.dr);
        group.add(arrow);
      }
    });
  }

  /** The AI's revealed optimal solution -- unnumbered, since it's a single proposed sequence rather than moves already taken. */
  showSolutionPath(moves: readonly { color: RobotColor; path: readonly Cell[] }[]): void {
    this.clearSolutionPath();
    const group = new THREE.Group();
    this.drawDashedMoves(group, moves, false);
    this.scene.add(group);
    this.solutionPathGroup = group;
  }

  clearSolutionPath(): void {
    if (!this.solutionPathGroup) return;
    this.scene.remove(this.solutionPathGroup);
    disposeObject3D(this.solutionPathGroup);
    this.solutionPathGroup = null;
  }

  /**
   * The live trail of moves an attempting player has actually made so far
   * this turn -- numbered in move order (1, 2, 3, ...) so a multi-move
   * attempt stays easy to read back. Redraw with the full current move list
   * on every move/undo; an empty list just clears it.
   *
   * `lighten` (0-1) shifts the trail toward white -- used once a round
   * resolves and the player clicks "Reveal Optimal Solution": Game.ts
   * redraws the same attempt trail at a lightened shade so it reads as "what
   * you did" sitting behind the freshly drawn, full-color optimal solution,
   * rather than the two competing for attention in identical colors.
   */
  showMoveTrail(moves: readonly { color: RobotColor; path: readonly Cell[] }[], lighten = 0): void {
    this.clearMoveTrail();
    if (moves.length === 0) return;
    const group = new THREE.Group();
    this.drawDashedMoves(group, moves, true, lighten);
    this.scene.add(group);
    this.moveTrailGroup = group;
  }

  clearMoveTrail(): void {
    if (!this.moveTrailGroup) return;
    this.scene.remove(this.moveTrailGroup);
    disposeObject3D(this.moveTrailGroup);
    this.moveTrailGroup = null;
  }

  robotColorAt(intersectedObject: THREE.Object3D): RobotColor | null {
    for (const color of ROBOT_COLORS) {
      if (this.robotMeshes[color] === intersectedObject) return color;
    }
    return null;
  }

  get pickableRobotMeshes(): THREE.Mesh[] {
    return ROBOT_COLORS.map((c) => this.robotMeshes[c]);
  }

  resize(width: number, height: number): void {
    this.applyAspect(width / height);
  }

  /**
   * A container wider than tall (the common case, once the left HUD sidebar
   * takes a fixed width and the board gets whatever's left) shows extra
   * horizontal world-space beyond the board's own square footprint -- this
   * pins that extra space entirely to the right (left edge fixed at
   * -viewSize/2) instead of splitting it evenly on both sides, so the board
   * sits right up against its container's left edge (which is already just
   * the 20px CSS margin away from the sidebar) rather than centered with a
   * wide gap on the sidebar side.
   */
  private applyAspect(aspect: number): void {
    this.camera.left = -this.viewSize / 2;
    this.camera.right = -this.viewSize / 2 + this.viewSize * aspect;
    this.camera.top = this.viewSize / 2;
    this.camera.bottom = -this.viewSize / 2;
    this.camera.updateProjectionMatrix();
  }
}
