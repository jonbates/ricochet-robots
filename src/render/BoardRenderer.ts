import {
  AmbientLight,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  CircleGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  type Material,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  Object3D,
  OrthographicCamera,
  Plane,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Raycaster,
  RingGeometry,
  Scene,
  Shape,
  ShapeGeometry,
  type Texture,
  Vector2,
  Vector3,
  type WebGLRenderer,
} from 'three';
import { EXRLoader } from 'three/examples/jsm/loaders/EXRLoader.js';
import { BOARD_SIZE, type Board, type Cell, cellKey, ROBOT_COLORS, type RobotColor } from '../board/Board';
import { VAULT_CELLS } from '../board/BoardLayout';
import type { RobotPositions } from '../game/GameState';
import type { Target, TargetShape } from '../board/BoardLayout';
import { darkenHex, lightenHex, mixHex, ROBOT_HEX, targetColorHex, WARP_SECONDARY_HEX } from '../colors';

const TILE_LIGHT = 0xeef2f6;
const TILE_DARK = 0xdbe3ea;
const WALL_COLOR = 0x64748b;
const VAULT_COLOR = 0x1a1a2e;

const TILE_TOP = 0; // world Y of the playable tile surface
const WALL_HEIGHT = 0.36;
const ROBOT_RADIUS = 0.32;
const ROBOT_HEIGHT = 0.52;
const ROBOT_SIDES = 24; // smooth circle -- that outline is reserved for robots; target icons use stars/squares/etc instead, so the two never look alike
const ROBOT_DOME_RADIUS = 0.18;
const ROBOT_DOME_DARKEN = 0.55; // how much darker than the body the top "dome" decal is
const ROBOT_RING_INNER = 0.36;
const ROBOT_RING_OUTER = 0.42;
const ROBOT_RING_LIGHTEN = 0.5; // how much lighter than the body the surrounding ring is
const ROBOT_EMISSIVE_INTENSITY = 0.7; // keeps the body glowing its own color even in shadow, without washing out the metallic highlight/shading
// Pushed well past 1 -- the camera looks straight down at the robots' mostly-flat
// tops, so the reflected view direction is close to the surface normal and mostly
// samples one fairly uniform patch of the HDRI (its "ceiling"/sky region) rather
// than a sweep across the scene the way an angled view would; a boosted intensity
// and low clearcoat roughness are what make that patch actually read as a bright,
// glassy highlight instead of a barely-there tint at this camera angle.
const ROBOT_ENV_MAP_INTENSITY = 3.5;
const ROBOT_CLEARCOAT = 0.8; // a thin glossy top layer -- gives the metal a sharper, wet-look specular highlight than metalness/roughness alone
const ROBOT_CLEARCOAT_ROUGHNESS = 0.05;
/** Served from public/ (see vite.config.ts's `base`) -- a real-world HDRI so the robots' high-metalness bodies have something to actually reflect, rather than relying solely on the emissive-color workaround (see buildRobots). */
const ENVIRONMENT_MAP_URL = `${import.meta.env.BASE_URL}historic_cloister_passage_1k.exr`;
const ROBOT_RING_Y_WORLD = 0.025; // just above the target-icon rings, so a robot standing on a target still reads as a robot first
const ROBOT_TOP_ICON_Y = ROBOT_HEIGHT + 0.002; // just above the dome, so a robot parked on a target still shows which one -- see updateRobotTopIcon
const ROBOT_TOP_ICON_SCALE = 0.7; // shrinks the (board-scale) icon+ring down to fit within the robot's own top face
const WALL_THICKNESS = 0.08;
const DEFLECTOR_LENGTH = 1.1;
const DEFLECTOR_THICKNESS = 0.16;
const DEFLECTOR_HEIGHT = 0.08;
const ROBOT_CLICK_RADIUS = 0.75; // world units (a cell is 1x1) -- see robotAt()

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
const ICON_CIRCLE_Y_OFFSET = -0.0015; // between the ring and the shape -- see buildIconWithRing
// The target icon itself is unlit (MeshBasicMaterial, like every target
// icon -- see buildIconMesh), so this light doesn't change the icon's own
// color; what it actually does is pool a soft glow across the lit tiles
// (and any lit, metallic robot) around it, calling out the active cell the
// same way a reading lamp calls out a spot on a desk. Low height and a
// short falloff distance keep that pool tight to the target instead of
// washing out neighboring cells.
const TARGET_LIGHT_COLOR = 0xfff2cc;
const TARGET_LIGHT_INTENSITY = 3.5;
const TARGET_LIGHT_DISTANCE = 2.6;
const TARGET_LIGHT_Y = 1.1;
/** How much of the target's own color bleeds into its spotlight -- kept low so the light still reads as warm white with a hint of the target's hue, not a flat color wash. */
const TARGET_LIGHT_TINT = 0.5;
/** A second, dimmer copy of the target spotlight that follows the robot the round is actually asking you to move (see updateRobotLight) -- same tinted color and falloff, so the two pools read as a matched pair calling out "this robot, that square". Deliberately well under TARGET_LIGHT_INTENSITY: the target is the thing to find on the board, and this shouldn't compete with it. */
const ROBOT_LIGHT_INTENSITY = 1.4;
/** Radii of the ring marking the currently selected robot. Comfortably wider than the robot's own base ring (ROBOT_RING_OUTER) so it reads as a separate marker around the robot rather than another band on it, even though that means spilling slightly past the robot's own 1x1 cell. */
const SELECTION_RING_INNER = 0.57;
const SELECTION_RING_OUTER = 0.72;
/** Revolutions each warp-target swirl arm makes from center to rim -- higher winds the vortex tighter. */
const WARP_SWIRL_TURNS = 2.4;
/** Rim-end stroke widths of the two swirl arms (see buildIconMesh) -- the secondary arm stays a touch thinner than the primary so the two strands stay visually distinct instead of reading as one doubled-up ribbon. */
const WARP_SWIRL_PRIMARY_WIDTH = 0.22;
const WARP_SWIRL_SECONDARY_WIDTH = 0.19;
const VAULT_ICON_Y = 0.13; // sits on top of the vault box (height 0.12)
const SOLUTION_PATH_Y = 0.09;
const SOLUTION_DASH_LENGTH = 0.16;
const SOLUTION_DASH_GAP = 0.12;
const SOLUTION_DASH_WIDTH = 0.05;
const SOLUTION_ARROW_LENGTH = 0.312;
const SOLUTION_ARROW_WIDTH = 0.264;
const SOLUTION_SHADOW_PAD = 0.044; // extra length/width baked into the dark shadow copy of each dash/arrow, so it peeks out from under the colored one on every side
const SOLUTION_SHADOW_Y = SOLUTION_PATH_Y - 0.01; // just beneath the colored dashes/arrows, so it reads as a shadow rather than fighting them for depth
const SOLUTION_ARROW_PULLBACK = 1; // one board square -- the arrowhead would otherwise land exactly under the robot's own mesh at the destination cell and be invisible
const SOLUTION_JITTER_STEP = 0.07; // sideways offset per move, so overlapping moves (a later one retracing an earlier one's cells) run side by side instead of exactly on top of each other
const SOLUTION_JITTER_CYCLE = 5; // offsets cycle through a small +/- range rather than drifting further apart with every extra move in a long solution
const TRAIL_LABEL_RADIUS = 0.32;
// Above ROBOT_HEIGHT, not just the dash/arrow layer -- a revealed
// solution's first move for any given robot starts from that robot's real,
// not-yet-"moved" board position, so its number badge lands directly under
// the robot's own opaque cylinder body. From this straight-down camera,
// anything below the robot's flat top face at y=ROBOT_HEIGHT is fully
// hidden, not just visually layered under it -- every subsequent move for
// that same robot is fine (its simulated position has diverged from the
// real one by then), but the very first one for each robot in the solution
// needs to clear the robot's own height to ever be visible at all. Derived
// from ROBOT_HEIGHT rather than hardcoded so that resizing the robots can't
// silently sink these badges back underneath them.
const TRAIL_LABEL_Y = ROBOT_HEIGHT + 0.01;

/** A flat, unlit shape geometry for a target icon -- square/diamond/triangle come "for free" out of a low-segment CircleGeometry with a chosen starting angle; the star and the warp target's swirl need real outlines. Deliberately no smooth-circle icon shape -- that outline is reserved for robots (see buildRobots), so a target is never visually confused with one. */
function buildIconGeometry(shape: TargetShape): BufferGeometry {
  switch (shape) {
    case 'star':
      return buildStarGeometry(0.3, 0.13, 5);
    case 'square':
      // 4-gon vertices land on the axes by default (a diamond); starting the
      // first vertex at 45 degrees instead lands them on the diagonals, i.e.
      // an axis-aligned square.
      return new CircleGeometry(0.24, 4, Math.PI / 4);
    case 'diamond':
      return new CircleGeometry(0.28, 4);
    case 'triangle':
      return new CircleGeometry(0.3, 3);
    case 'swirl':
      return buildSwirlGeometry(0.32, WARP_SWIRL_TURNS, WARP_SWIRL_PRIMARY_WIDTH, 60);
  }
}

/** A full five-pointed star outline, traced as one 10-vertex polygon alternating outer points and inner concave vertices. */
function buildStarGeometry(outerRadius: number, innerRadius: number, points: number): ShapeGeometry {
  const shape = new Shape();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerRadius : innerRadius;
    const angle = (i / (points * 2)) * Math.PI * 2 - Math.PI / 2;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    if (i === 0) shape.moveTo(x, y);
    else shape.lineTo(x, y);
  }
  shape.closePath();
  return new ShapeGeometry(shape);
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
function buildSwirlGeometry(maxRadius: number, turns: number, strokeWidth: number, segments: number, phaseOffset = 0): ShapeGeometry {
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
  const shape = new Shape();
  shape.moveTo(outer[0].x, outer[0].y);
  for (const p of outer.slice(1)) shape.lineTo(p.x, p.y);
  for (const p of inner.slice().reverse()) shape.lineTo(p.x, p.y);
  shape.closePath();
  return new ShapeGeometry(shape);
}

/** Per-robot bookkeeping for the icon shown on top of it when it's parked on a target -- see buildRobots and updateRobotTopIcon. */
interface RobotTopIconState {
  readonly container: Group;
  icon: Group | null;
  shownKey: string | null;
}

function disposeObject3D(obj: Object3D): void {
  obj.traverse((child) => {
    if (child instanceof Mesh) {
      child.geometry.dispose();
      const material = child.material as Material & { map?: Texture | null };
      material.map?.dispose(); // numbered move-trail labels carry a canvas texture that needs its own disposal
      material.dispose();
    }
  });
}

/** A small canvas-drawn "(n)" badge -- solid circle in the move's own color, white ring, white number -- as a texture, since there's no 3D font loaded for real text geometry. Cheap enough to regenerate on every trail redraw (at most a couple dozen small canvases for a long attempt). */
function buildNumberLabelTexture(n: number, hexColor: number): CanvasTexture {
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
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, (size / 4) * 1.21, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 64px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(String(n), size / 2, size / 2 + 4);
  return new CanvasTexture(canvas);
}

function buildNumberLabel(n: number, hexColor: number): Mesh {
  const geometry = new CircleGeometry(TRAIL_LABEL_RADIUS, 24);
  const material = new MeshBasicMaterial({ map: buildNumberLabelTexture(n, hexColor), transparent: true });
  const mesh = new Mesh(geometry, material);
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
function buildFlatRectGeometry(length: number, width: number): BufferGeometry {
  const hl = length / 2;
  const hw = width / 2;
  const positions = new Float32Array([-hl, 0, -hw, hl, 0, -hw, hl, 0, hw, -hl, 0, -hw, hl, 0, hw, -hl, 0, hw]);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  return geometry;
}

/** A flat arrowhead triangle, apex at local +X -- see buildFlatRectGeometry for why it's authored directly in the XZ plane. */
function buildFlatArrowGeometry(length: number, width: number): BufferGeometry {
  const hw = width / 2;
  const positions = new Float32Array([0, 0, hw, 0, 0, -hw, length, 0, 0]);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new BufferAttribute(positions, 3));
  return geometry;
}

/**
 * Owns the Three.js scene, the orthographic top-down camera, and every mesh
 * on the board. Static geometry (tiles, walls, vault) is built once from
 * BoardLayout; robot/target/selection meshes are repositioned each time
 * GameState changes rather than rebuilt.
 */
export class BoardRenderer {
  readonly scene = new Scene();
  readonly camera: OrthographicCamera;

  private readonly viewSize = BOARD_SIZE + 3; // grid extent plus a margin

  /** What fraction of the container's height the board itself occupies on screen when the container is at least as wide as it is tall (aspect >= 1) -- the camera's vertical extent is exactly `viewSize` in that case, so this ratio (times the container's pixel height) is the board's rendered pixel width too, since applyAspect keeps a uniform (non-stretching) scale. Below aspect 1 (a narrow, stacked mobile container) the board's width is the *container's* full width instead -- see Game.ts's handleResize, which picks between the two. */
  readonly boardToViewRatio = BOARD_SIZE / this.viewSize;
  private readonly robotMeshes: Record<RobotColor, Group>;
  /** Each robot's on-top-of-the-body icon slot -- see buildRobots and updateRobotTopIcon. */
  private readonly robotTopIcons: Record<RobotColor, RobotTopIconState>;
  /** Every static target, keyed by cell, for the on-top-of-robot icon handling in setRobotPositions(). */
  private readonly targetsByCell: ReadonlyMap<string, Target>;
  private readonly pickRaycaster = new Raycaster();
  private readonly pickPlane = new Plane(new Vector3(0, 1, 0), -TILE_TOP); // the tile surface, for cellAt()
  private readonly activeTargetHighlight: Mesh;
  private readonly targetLight: PointLight;
  /** Follows whichever robot matches the active target's color -- see updateRobotLight. */
  private readonly robotLight: PointLight;
  /** Which robot the active target is asking for, or null for the warp target, which any robot can claim and so has no one robot to call out. */
  private targetRobotColor: RobotColor | null = null;
  private readonly selectionHighlight: Mesh;
  private readonly vaultIconGroup: Group;
  private vaultIconMesh: Group | null = null;
  private solutionPathGroup: Group | null = null;
  private moveTrailGroup: Group | null = null;

  constructor(board: Board, targets: readonly Target[]) {
    this.scene.background = new Color(0x0a1a2a);
    this.camera = new OrthographicCamera(-1, 1, 1, -1, 0.1, 100);
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

    ({ meshes: this.robotMeshes, topIcons: this.robotTopIcons } = this.buildRobots());
    this.buildTargetIcons(targets);
    this.targetsByCell = new Map(targets.map((t) => [cellKey(t.cell.col, t.cell.row), t]));
    this.activeTargetHighlight = this.buildRing(0.36, 0.44, 0xffffff, 0.02);
    this.targetLight = new PointLight(TARGET_LIGHT_COLOR, TARGET_LIGHT_INTENSITY, TARGET_LIGHT_DISTANCE, 2);
    this.targetLight.position.y = TARGET_LIGHT_Y;
    this.scene.add(this.targetLight);
    // Same falloff and height as the target's own light, just dimmer --
    // stays dark until setTarget names a robot color to follow.
    this.robotLight = new PointLight(TARGET_LIGHT_COLOR, ROBOT_LIGHT_INTENSITY, TARGET_LIGHT_DISTANCE, 2);
    this.robotLight.position.y = TARGET_LIGHT_Y;
    this.robotLight.visible = false;
    this.scene.add(this.robotLight);
    this.selectionHighlight = this.buildRing(SELECTION_RING_INNER, SELECTION_RING_OUTER, 0xffffff, 0.03);
    this.selectionHighlight.visible = false;
    this.vaultIconGroup = new Group();
    const { x: vaultX, z: vaultZ } = this.vaultCenter();
    this.vaultIconGroup.position.set(vaultX, 0, vaultZ);
    this.scene.add(this.vaultIconGroup);
  }

  /**
   * Loads the HDRI at ENVIRONMENT_MAP_URL and installs it as `scene.environment`
   * so the robots' MeshPhysicalMaterial has something to reflect, without it
   * also becoming the visible backdrop (scene.background is left as the flat
   * navy Color set in the constructor). Async and fire-and-forget from the
   * caller's side (Game.ts kicks this off right after construction, not
   * awaited) -- the robots already read fine off their emissive fallback
   * before this resolves, so nothing needs to block on a ~1MB HDRI fetch.
   * Requires a live WebGLRenderer (PMREMGenerator compiles a shader against
   * it), which is why this isn't just called from the constructor: BoardRenderer
   * itself never holds a renderer reference, only the Scene/Camera Game.ts
   * later hands to one.
   *
   * scene.environmentIntensity is forced to 0 here, and only the robots'
   * materials are given the env map directly (material.envMap, not just the
   * scene fallback) -- a real WebGLRenderer quirk, not a design choice:
   * for any MeshStandardMaterial/Lambert/Phong that has no *own* envMap, the
   * renderer overwrites that material's envMapIntensity uniform with
   * scene.environmentIntensity every frame (WebGLRenderer.js, the
   * `material.envMap === null && scene.environment !== null` branch),
   * silently ignoring whatever the material's own envMapIntensity was set
   * to. Every non-robot material here (tiles, walls, vault, deflectors)
   * relies on that scene fallback rather than setting its own envMap, so
   * without this they'd all pick up full-intensity reflections the moment
   * this resolves, washing out the whole board -- confirmed by toggling
   * scene.environment live and watching every material brighten together,
   * not just the robots. Giving the robots their own explicit envMap exempts
   * them from that override, so their own (boosted) envMapIntensity applies.
   */
  async loadEnvironmentMap(renderer: WebGLRenderer): Promise<void> {
    const pmremGenerator = new PMREMGenerator(renderer);
    try {
      const texture = await new EXRLoader().loadAsync(ENVIRONMENT_MAP_URL);
      const envMap = pmremGenerator.fromEquirectangular(texture).texture;
      this.scene.environment = envMap;
      this.scene.environmentIntensity = 0;
      for (const mesh of Object.values(this.robotMeshes)) {
        mesh.traverse((obj) => {
          // Only the body and dome are MeshPhysicalMaterial (see buildRobots)
          // -- the ring stays MeshBasicMaterial (flat, unlit) and is
          // deliberately skipped here.
          if (!(obj instanceof Mesh) || !(obj.material instanceof MeshPhysicalMaterial)) return;
          obj.material.envMap = envMap;
          obj.material.needsUpdate = true;
        });
      }
      texture.dispose();
    } catch (err) {
      // Non-fatal -- the robots' emissive fallback (see buildRobots) already
      // carries them without this, so a dropped fetch or unsupported
      // environment shouldn't be a fire-and-forget unhandled rejection.
      console.warn('Failed to load environment map, continuing without reflections', err);
    } finally {
      pmremGenerator.dispose();
    }
  }

  private buildLights(): void {
    this.scene.add(new AmbientLight(0xffffff, 0.8));
    // Placed up and off to the screen's front-right (+Z reads as "south"/
    // the bottom of the screen, +X as east/right -- see the camera's up
    // vector above) so the cast shadows fall up-and-left across the board,
    // reading as the depth cue that sells the robots as 3D bodies rather
    // than flat painted circles. A shadow lands on the far side of its
    // caster from the light, so this is the mirror-image placement of "the
    // light is up/back/left" -- putting the light at front-right is what
    // makes the shadow fall toward back-left. Still a fairly low/grazing
    // angle (large horizontal offset relative to height): a robot's cast
    // shadow is a same-size disc translated sideways by height*tan(angle),
    // and the robot's own decorative base ring (buildRobots' ROBOT_RING,
    // out to radius 0.42) already covers a shallow-angle shadow almost
    // entirely, leaving nothing visibly poking out. This angle keeps that
    // translation past the ring for the ROBOT_HEIGHT-tall cylinders.
    const sun = new DirectionalLight(0xffffff, 0.75);
    sun.position.set(9, 10, 9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.02; // paired with the low bias above -- grazing angles need this to avoid acne without peter-panning the shadow off its caster
    sun.shadow.radius = 6; // blur amount for the VSMShadowMap set up in Game.ts -- softens the otherwise hard-edged cast shadows
    sun.shadow.blurSamples = 16; // more taps than the VSM default (8) so that blur stays smooth rather than banding at this radius
    const shadowExtent = BOARD_SIZE / 2 + 2; // board is BOARD_SIZE wide/deep, centered on the origin
    sun.shadow.camera.left = -shadowExtent;
    sun.shadow.camera.right = shadowExtent;
    sun.shadow.camera.top = shadowExtent;
    sun.shadow.camera.bottom = -shadowExtent;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 40;
    this.scene.add(sun);
  }

  private buildTiles(): void {
    const group = new Group();
    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const geometry = new PlaneGeometry(1, 1);
        const color = (col + row) % 2 === 0 ? TILE_LIGHT : TILE_DARK;
        const material = new MeshStandardMaterial({ color, roughness: 0.9 });
        const mesh = new Mesh(geometry, material);
        mesh.rotation.x = -Math.PI / 2;
        mesh.receiveShadow = true;
        const { x, z } = cellToWorld({ col, row });
        mesh.position.set(x, TILE_TOP, z);
        group.add(mesh);
      }
    }
    this.scene.add(group);
  }

  private buildGridLines(): void {
    const half = BOARD_SIZE / 2;
    const points: Vector3[] = [];
    for (let i = 0; i <= BOARD_SIZE; i++) {
      const offset = i - half;
      points.push(new Vector3(offset, 0.005, -half), new Vector3(offset, 0.005, half));
      points.push(new Vector3(-half, 0.005, offset), new Vector3(half, 0.005, offset));
    }
    const geometry = new BufferGeometry().setFromPoints(points);
    const material = new LineBasicMaterial({ color: 0xb9c4cf, transparent: true, opacity: 0.6 });
    this.scene.add(new LineSegments(geometry, material));
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

    const geometry = new BoxGeometry(width, 0.12, depth);
    const material = new MeshStandardMaterial({ color: VAULT_COLOR, roughness: 0.7 });
    const mesh = new Mesh(geometry, material);
    mesh.receiveShadow = true;
    mesh.position.set(x, 0.06, z);
    this.scene.add(mesh);
  }

  /** Interior walls only -- the outer boundary gets its own frame in buildBoundaryFrame(). Each wall is authored symmetrically on both cells it separates, so only N/W bits are drawn to avoid drawing the same physical segment twice. */
  private buildWalls(board: Board): void {
    const group = new Group();
    const geometryNS = new BoxGeometry(1 + WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS);
    const geometryEW = new BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, 1 + WALL_THICKNESS);
    const material = new MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.6 });

    for (let row = 0; row < BOARD_SIZE; row++) {
      for (let col = 0; col < BOARD_SIZE; col++) {
        const { x, z } = cellToWorld({ col, row });
        if (board.hasWall(col, row, 'N')) {
          const mesh = new Mesh(geometryNS, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.position.set(x, WALL_HEIGHT / 2, z - 0.5);
          group.add(mesh);
        }
        if (board.hasWall(col, row, 'W')) {
          const mesh = new Mesh(geometryEW, material);
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.position.set(x - 0.5, WALL_HEIGHT / 2, z);
          group.add(mesh);
        }
      }
    }
    this.scene.add(group);
  }

  private buildBoundaryFrame(): void {
    const half = BOARD_SIZE / 2;
    const material = new MeshStandardMaterial({ color: WALL_COLOR, roughness: 0.6 });
    const long = new BoxGeometry(BOARD_SIZE + WALL_THICKNESS, WALL_HEIGHT, WALL_THICKNESS);
    const north = new Mesh(long, material);
    north.position.set(0, WALL_HEIGHT / 2, -half);
    const south = new Mesh(long, material);
    south.position.set(0, WALL_HEIGHT / 2, half);
    const sideGeom = new BoxGeometry(WALL_THICKNESS, WALL_HEIGHT, BOARD_SIZE + WALL_THICKNESS);
    const west = new Mesh(sideGeom, material);
    west.position.set(-half, WALL_HEIGHT / 2, 0);
    const east = new Mesh(sideGeom, material);
    east.position.set(half, WALL_HEIGHT / 2, 0);
    for (const wall of [north, south, west, east]) {
      wall.castShadow = true;
      wall.receiveShadow = true;
    }
    this.scene.add(north, south, west, east);
  }

  /** Diagonal bars for the diagonal board variant -- a no-op (empty list) for the classic variant, which has none. */
  private buildDeflectors(board: Board): void {
    const geometry = new BoxGeometry(DEFLECTOR_LENGTH, DEFLECTOR_HEIGHT, DEFLECTOR_THICKNESS);
    for (const deflector of board.getAllDeflectors()) {
      const material = new MeshStandardMaterial({ color: ROBOT_HEX[deflector.color], roughness: 0.4 });
      const mesh = new Mesh(geometry, material);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
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
   * cell. Lit, metallic body (MeshPhysicalMaterial, for its clearcoat layer
   * and envMapIntensity control on top of MeshStandardMaterial's own
   * metalness/roughness) so it actually picks up the sun/ambient and casts a
   * color-tinted highlight rather than reading as a flat painted disc --
   * loadEnvironmentMap() feeds it a real HDRI to reflect too, once that
   * finishes loading -- plus a low-intensity emissive in the same color so
   * the body still reads as its own color inside its own cast shadow or a
   * neighbor's, or before the environment map has loaded in, rather than
   * going fully dark there -- target icons stay
   * on MeshBasicMaterial, so a robot no longer matches them pixel-for-pixel,
   * but the two are already told apart by shape (circle vs.
   * star/square/diamond/triangle/swirl), so that's fine. A smaller, darker
   * circular "dome" decal sits on top as a
   * cheap top-down stand-in for a rounded 3D robot body, and a lighter ring
   * sits around its base on the tile -- both opt out of raycasting so
   * clicks still resolve to the body mesh beneath them.
   */
  private buildRobots(): { meshes: Record<RobotColor, Group>; topIcons: Record<RobotColor, RobotTopIconState> } {
    const geometry = new CylinderGeometry(ROBOT_RADIUS, ROBOT_RADIUS, ROBOT_HEIGHT, ROBOT_SIDES);
    const domeGeometry = new CircleGeometry(ROBOT_DOME_RADIUS, 24);
    const ringGeometry = new RingGeometry(ROBOT_RING_INNER, ROBOT_RING_OUTER, 32);
    const meshes = {} as Record<RobotColor, Group>;
    const topIcons = {} as Record<RobotColor, RobotTopIconState>;
    for (const color of ROBOT_COLORS) {
      const group = new Group();

      const material = new MeshPhysicalMaterial({
        color: ROBOT_HEX[color],
        metalness: 0.9,
        roughness: 0.1,
        emissive: ROBOT_HEX[color],
        emissiveIntensity: ROBOT_EMISSIVE_INTENSITY,
        envMapIntensity: ROBOT_ENV_MAP_INTENSITY,
        clearcoat: ROBOT_CLEARCOAT,
        clearcoatRoughness: ROBOT_CLEARCOAT_ROUGHNESS,
      });
      const body = new Mesh(geometry, material);
      // Casts *and* receives a shadow now that it's lit -- a metallic
      // surface reads as flat color without the shading/highlight a real
      // light gives it, and it should darken under a neighbor's shadow too.
      body.castShadow = true;
      body.receiveShadow = true;
      body.position.y = ROBOT_HEIGHT / 2;
      group.add(body);

      // Emissive-tinted on the same terms as the body above, or it renders
      // essentially black: at this metalness there's near-zero diffuse, and
      // with no environment map a mirror-like metal has nothing to reflect.
      // Feeding it its own already-darkened color keeps the dome reading as
      // a darker accent (ROBOT_DOME_DARKEN of the body's brightness) rather
      // than flattening it to match the body.
      const domeColor = darkenHex(ROBOT_HEX[color], ROBOT_DOME_DARKEN);
      const domeMaterial = new MeshPhysicalMaterial({
        color: domeColor,
        metalness: 0.9,
        roughness: 0.1,
        emissive: domeColor,
        emissiveIntensity: ROBOT_EMISSIVE_INTENSITY,
        envMapIntensity: ROBOT_ENV_MAP_INTENSITY,
        clearcoat: ROBOT_CLEARCOAT,
        clearcoatRoughness: ROBOT_CLEARCOAT_ROUGHNESS,
      });
      const dome = new Mesh(domeGeometry, domeMaterial);
      dome.rotation.x = -Math.PI / 2;
      dome.position.y = ROBOT_HEIGHT + 0.001; // just above the body's own top face
      dome.raycast = () => {};
      group.add(dome);

      const ringMaterial = new MeshBasicMaterial({ color: lightenHex(ROBOT_HEX[color], ROBOT_RING_LIGHTEN), side: DoubleSide });
      const ring = new Mesh(ringGeometry, ringMaterial);
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = ROBOT_RING_Y_WORLD; // on the tile around the body's base
      ring.raycast = () => {};
      group.add(ring);

      // Empty until a robot actually parks on a target (see
      // updateRobotTopIcon) -- holds a shrunk copy of that target's icon so
      // it stays visible from this straight-down camera instead of being
      // hidden under the (fully opaque) body.
      const topIconContainer = new Group();
      topIconContainer.position.y = ROBOT_TOP_ICON_Y;
      topIconContainer.raycast = () => {};
      group.add(topIconContainer);

      this.scene.add(group);
      meshes[color] = group;
      topIcons[color] = { container: topIconContainer, icon: null, shownKey: null };
    }
    return { meshes, topIcons };
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

  private buildIconMesh(target: Target): Object3D {
    if (target.shape === 'swirl') {
      // A second, thinner arm in a contrasting warm color (opposite the
      // primary purple arm, phase-shifted by half a turn) so the vortex
      // reads as two interleaved strands rather than one flat purple shape.
      const group = new Group();
      const primary = new Mesh(
        buildSwirlGeometry(0.32, WARP_SWIRL_TURNS, WARP_SWIRL_PRIMARY_WIDTH, 60),
        new MeshBasicMaterial({ color: targetColorHex(target.color), side: DoubleSide }),
      );
      const secondary = new Mesh(
        buildSwirlGeometry(0.32, WARP_SWIRL_TURNS, WARP_SWIRL_SECONDARY_WIDTH, 60, Math.PI),
        new MeshBasicMaterial({ color: WARP_SECONDARY_HEX, side: DoubleSide }),
      );
      primary.rotation.x = -Math.PI / 2;
      secondary.rotation.x = -Math.PI / 2;
      secondary.position.y = 0.001; // just above the primary arm, avoiding z-fighting where they'd otherwise coincide at the center
      group.add(primary, secondary);
      return group;
    }
    const geometry = buildIconGeometry(target.shape);
    const material = new MeshBasicMaterial({ color: targetColorHex(target.color), side: DoubleSide });
    const mesh = new Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    return mesh;
  }

  /**
   * An icon shape sitting on a white circle, itself ringed in that target's
   * color -- shapes alone (especially the star vs. the round robots, or the
   * swirl vs. a busy board) can be hard to tell apart at a glance, so the
   * surrounding color ring gives an immediate "which robot" cue independent
   * of the inner shape, and the white circle behind the shape guarantees
   * contrast against it regardless of how the shape's own color happens to
   * read against a plain tile (a yellow shape on a light tile, say).
   */
  private buildIconWithRing(target: Target): Group {
    const group = new Group();
    const ringGeometry = new RingGeometry(ICON_RING_INNER, ICON_RING_OUTER, 32);
    const ringMaterial = new MeshBasicMaterial({ color: targetColorHex(target.color), side: DoubleSide });
    const ring = new Mesh(ringGeometry, ringMaterial);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = ICON_RING_Y_OFFSET;
    group.add(ring);

    const circleGeometry = new CircleGeometry(ICON_RING_INNER, 32);
    const circleMaterial = new MeshBasicMaterial({ color: 0xffffff, side: DoubleSide });
    const circle = new Mesh(circleGeometry, circleMaterial);
    circle.rotation.x = -Math.PI / 2;
    circle.position.y = ICON_CIRCLE_Y_OFFSET;
    group.add(circle);

    group.add(this.buildIconMesh(target));
    return group;
  }

  private buildRing(innerRadius: number, outerRadius: number, color: number, y: number): Mesh {
    const geometry = new RingGeometry(innerRadius, outerRadius, 32);
    const material = new MeshBasicMaterial({ color, transparent: true, opacity: 0.85, side: DoubleSide });
    const mesh = new Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = y;
    this.scene.add(mesh);
    return mesh;
  }

  setRobotPositions(robots: RobotPositions): void {
    for (const color of ROBOT_COLORS) {
      const cell = robots[color];
      const { x, z } = cellToWorld(cell);
      this.robotMeshes[color].position.x = x;
      this.robotMeshes[color].position.z = z;
      // A robot parked on a target would otherwise completely hide that
      // target's icon from this straight-down camera -- which target a
      // robot is sitting on is exactly the thing you're squinting at while
      // solving -- so show a shrunk copy of it on top of the robot instead.
      this.updateRobotTopIcon(color, this.targetsByCell.get(cellKey(cell.col, cell.row)));
    }
    this.updateRobotLight(); // the robot it follows has almost certainly just moved
  }

  /** Parks the robot spotlight over whichever robot the active target calls for, or darkens it entirely when the target is the warp (no one robot owns it) or no target has been set yet. */
  private updateRobotLight(): void {
    if (!this.targetRobotColor) {
      this.robotLight.visible = false;
      return;
    }
    const { position } = this.robotMeshes[this.targetRobotColor];
    this.robotLight.position.x = position.x;
    this.robotLight.position.z = position.z;
    this.robotLight.visible = true;
  }

  /**
   * Shows a shrunk copy of `target`'s icon on top of the robot (or clears it
   * when `target` is undefined, i.e. the robot isn't on any target) -- the
   * `shownKey` early-out keeps the rebuild (which allocates fresh geometry
   * via buildIconWithRing) off the per-frame path, leaving it only on the
   * handful of frames where a robot actually steps onto or off of a target.
   */
  private updateRobotTopIcon(color: RobotColor, target: Target | undefined): void {
    const state = this.robotTopIcons[color];
    const key = target ? cellKey(target.cell.col, target.cell.row) : null;
    if (state.shownKey === key) return;
    if (state.icon) {
      state.container.remove(state.icon);
      disposeObject3D(state.icon);
      state.icon = null;
    }
    if (target) {
      const icon = this.buildIconWithRing(target);
      icon.scale.setScalar(ROBOT_TOP_ICON_SCALE);
      state.container.add(icon);
      state.icon = icon;
    }
    state.shownKey = key;
  }

  /** Moves the highlight ring (and its accompanying soft glow) onto whichever static target icon is now active, and refreshes the vault's reference-card copy of that same icon. */
  setTarget(target: Target): void {
    const { x, z } = cellToWorld(target.cell);
    this.activeTargetHighlight.position.x = x;
    this.activeTargetHighlight.position.z = z;
    this.targetLight.position.x = x;
    this.targetLight.position.z = z;
    const tinted = mixHex(TARGET_LIGHT_COLOR, targetColorHex(target.color), TARGET_LIGHT_TINT);
    this.targetLight.color.setHex(tinted);
    // The robot that has to reach this target gets the same tint, so the two
    // lit pools read as the two ends of the round's one job.
    this.robotLight.color.setHex(tinted);
    this.targetRobotColor = ROBOT_COLORS.includes(target.color as RobotColor) ? (target.color as RobotColor) : null;
    this.updateRobotLight();

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
  private drawDashedMoves(group: Group, moves: readonly { color: RobotColor; path: readonly Cell[] }[], numbered: boolean): void {
    const dashGeometry = buildFlatRectGeometry(SOLUTION_DASH_LENGTH, SOLUTION_DASH_WIDTH);
    const arrowGeometry = buildFlatArrowGeometry(SOLUTION_ARROW_LENGTH, SOLUTION_ARROW_WIDTH);
    const dashShadowGeometry = buildFlatRectGeometry(SOLUTION_DASH_LENGTH + SOLUTION_SHADOW_PAD, SOLUTION_DASH_WIDTH + SOLUTION_SHADOW_PAD);
    const arrowShadowGeometry = buildFlatArrowGeometry(SOLUTION_ARROW_LENGTH + SOLUTION_SHADOW_PAD, SOLUTION_ARROW_WIDTH + SOLUTION_SHADOW_PAD);
    const shadowMaterial = new MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.7, side: DoubleSide, depthWrite: false });

    moves.forEach((move, moveIndex) => {
      const material = new MeshBasicMaterial({ color: ROBOT_HEX[move.color], side: DoubleSide });
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
          const dashX = run.a.x + (run.b.x - run.a.x) * t + perpX;
          const dashZ = run.a.z + (run.b.z - run.a.z) * t + perpZ;

          const shadow = new Mesh(dashShadowGeometry, shadowMaterial);
          shadow.position.set(dashX, SOLUTION_SHADOW_Y, dashZ);
          shadow.rotation.y = angle;
          group.add(shadow);

          const dash = new Mesh(dashGeometry, material);
          dash.position.set(dashX, SOLUTION_PATH_Y, dashZ);
          dash.rotation.y = angle;
          group.add(dash);
        }
      }

      const firstRun = runs[0];
      if (numbered && firstRun) {
        const perpX = -firstRun.dr * jitter;
        const perpZ = firstRun.dc * jitter;
        const label = buildNumberLabel(moveIndex + 1, ROBOT_HEX[move.color]);
        label.position.set(firstRun.a.x + perpX, TRAIL_LABEL_Y, firstRun.a.z + perpZ);
        group.add(label);
      }

      const lastRun = runs[runs.length - 1];
      if (lastRun) {
        const perpX = -lastRun.dr * jitter;
        const perpZ = lastRun.dc * jitter;
        const arrowAngle = directionAngle(lastRun.dc, lastRun.dr);
        const runLength = Math.hypot(lastRun.b.x - lastRun.a.x, lastRun.b.z - lastRun.a.z);
        const pullback = Math.min(SOLUTION_ARROW_PULLBACK, runLength);
        const arrowX = lastRun.b.x - lastRun.dc * pullback;
        const arrowZ = lastRun.b.z - lastRun.dr * pullback;

        const arrowShadow = new Mesh(arrowShadowGeometry, shadowMaterial);
        arrowShadow.position.set(arrowX + perpX, SOLUTION_SHADOW_Y, arrowZ + perpZ);
        arrowShadow.rotation.y = arrowAngle;
        group.add(arrowShadow);

        const arrow = new Mesh(arrowGeometry, material);
        arrow.position.set(arrowX + perpX, SOLUTION_PATH_Y, arrowZ + perpZ);
        arrow.rotation.y = arrowAngle;
        group.add(arrow);
      }
    });
  }

  /** The AI's revealed optimal solution -- numbered in move order, same as the live attempt trail, so a multi-move solution stays easy to read back (which robot moves 1st, 2nd, ...). */
  showSolutionPath(moves: readonly { color: RobotColor; path: readonly Cell[] }[]): void {
    this.clearSolutionPath();
    const group = new Group();
    this.drawDashedMoves(group, moves, true);
    this.scene.add(group);
    this.solutionPathGroup = group;
  }

  clearSolutionPath(): void {
    if (!this.solutionPathGroup) return;
    this.scene.remove(this.solutionPathGroup);
    disposeObject3D(this.solutionPathGroup);
    this.solutionPathGroup = null;
  }

  /** The live trail of moves an attempting player has actually made so far this turn -- numbered in move order (1, 2, 3, ...) so a multi-move attempt stays easy to read back. Redraw with the full current move list on every move/undo; an empty list just clears it. Also cleared outright by Game.revealSolution(), rather than left drawn alongside the freshly revealed optimal path. */
  showMoveTrail(moves: readonly { color: RobotColor; path: readonly Cell[] }[]): void {
    this.clearMoveTrail();
    if (moves.length === 0) return;
    const group = new Group();
    this.drawDashedMoves(group, moves, true);
    this.scene.add(group);
    this.moveTrailGroup = group;
  }

  clearMoveTrail(): void {
    if (!this.moveTrailGroup) return;
    this.scene.remove(this.moveTrailGroup);
    disposeObject3D(this.moveTrailGroup);
    this.moveTrailGroup = null;
  }

  /** Intersects the camera ray for a click NDC coordinate against the tile plane, returning the board-space (x,z) world point it lands on, or null if the click misses the board's plane entirely. Shared by robotAt() below. */
  private raycastToBoardPoint(ndc: Vector2): { x: number; z: number } | null {
    this.pickRaycaster.setFromCamera(ndc, this.camera);
    const point = new Vector3();
    if (!this.pickRaycaster.ray.intersectPlane(this.pickPlane, point)) return null;
    return { x: point.x, z: point.z };
  }

  /**
   * Which robot (if any) a click NDC coordinate should select -- the nearest
   * robot whose cell center is within ROBOT_CLICK_RADIUS world units of the
   * click, rather than requiring the click to land inside that robot's own
   * 1x1 cell. A plain "which cell was clicked" test already covers the whole
   * square a robot occupies, but a tap landing just past that square's edge
   * (easy to do on a touch screen, especially reaching toward a robot near
   * the edge of the D-pad) would otherwise miss it entirely. 0.75 is
   * generous enough to forgive that while staying short of 1.0 (the distance
   * to an adjacent cell's own center), so a click still can't reach past a
   * robot on an intervening cell to grab one two cells away. Returns null
   * for a click that misses the board's plane, or lands outside every
   * robot's radius.
   */
  robotAt(ndc: Vector2, robots: RobotPositions): RobotColor | null {
    const point = this.raycastToBoardPoint(ndc);
    if (!point) return null;
    let closest: RobotColor | null = null;
    let closestDist = ROBOT_CLICK_RADIUS;
    for (const color of ROBOT_COLORS) {
      const { x, z } = cellToWorld(robots[color]);
      const dist = Math.hypot(point.x - x, point.z - z);
      if (dist <= closestDist) {
        closest = color;
        closestDist = dist;
      }
    }
    return closest;
  }

  resize(width: number, height: number): void {
    this.applyAspect(width / height);
  }

  /** Undoes whatever an orbit-debug camera (see Game.ts's 'o' toggle) did to position/up/zoom, restoring the fixed top-down view normal play expects -- mirrors the camera setup in the constructor above. */
  resetCameraToTopDown(): void {
    this.camera.position.set(0, 30, 0);
    this.camera.up.set(0, 0, -1);
    this.camera.zoom = 1;
    this.camera.lookAt(0, 0, 0);
    this.camera.updateProjectionMatrix();
  }

  /**
   * A container wider than tall (aspect >= 1 -- the desktop case, once the
   * left HUD sidebar takes a fixed width and the board gets whatever's
   * left) shows extra horizontal world-space beyond the board's own square
   * footprint; this pins that extra space entirely to the right (left edge
   * fixed at -viewSize/2) instead of splitting it evenly on both sides, so
   * the board sits right up against its container's left edge rather than
   * centered with a wide gap on the sidebar side.
   *
   * A container taller than wide (aspect < 1 -- stacked mobile, where the
   * board's own width is the viewport's width but its height is whatever's
   * left after the HUD strips) needs the opposite fix: showing the full
   * `viewSize` vertically here would only show `viewSize * aspect` (< 19)
   * horizontally, cropping real board cells off the right edge rather than
   * just trimming empty margin. So below aspect 1, pin the full `viewSize`
   * horizontally instead (top edge fixed at viewSize/2, matching the
   * left-pinned top edge above) and let the extra vertical space fall below
   * the board.
   */
  private applyAspect(aspect: number): void {
    this.camera.top = this.viewSize / 2;
    if (aspect >= 1) {
      this.camera.left = -this.viewSize / 2;
      this.camera.right = -this.viewSize / 2 + this.viewSize * aspect;
      this.camera.bottom = -this.viewSize / 2;
    } else {
      this.camera.left = -this.viewSize / 2;
      this.camera.right = this.viewSize / 2;
      this.camera.bottom = this.viewSize / 2 - this.viewSize / aspect;
    }
    this.camera.updateProjectionMatrix();
  }
}
