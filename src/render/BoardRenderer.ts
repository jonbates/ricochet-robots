import * as THREE from 'three';
import { BOARD_SIZE, type Board, type Cell, ROBOT_COLORS, type RobotColor } from '../board/Board';
import { VAULT_CELLS } from '../board/BoardLayout';
import type { RobotPositions } from '../game/GameState';
import type { Target } from '../board/BoardLayout';
import { ROBOT_HEX } from '../colors';

const TILE_LIGHT = 0xeef2f6;
const TILE_DARK = 0xdbe3ea;
const WALL_COLOR = 0x2c3e50;
const VAULT_COLOR = 0x1a1a2e;

const TILE_TOP = 0; // world Y of the playable tile surface
const WALL_HEIGHT = 0.36;
const ROBOT_RADIUS = 0.32;
const ROBOT_HEIGHT = 0.4;
const WALL_THICKNESS = 0.08;

/** cell -> world-space (x,z) so col/row grow toward +x/+z, centered on the origin. */
function cellToWorld(cell: Cell): { x: number; z: number } {
  const half = (BOARD_SIZE - 1) / 2;
  return { x: cell.col - half, z: cell.row - half };
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
  private readonly robotMeshes: Record<RobotColor, THREE.Mesh>;
  private readonly targetMesh: THREE.Mesh;
  private readonly targetMaterial: THREE.MeshBasicMaterial;
  private readonly highlightMesh: THREE.Mesh;

  constructor(board: Board) {
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

    this.robotMeshes = this.buildRobots();
    const { mesh, material } = this.buildTargetMarker();
    this.targetMesh = mesh;
    this.targetMaterial = material;
    this.highlightMesh = this.buildHighlight();
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

  private buildVault(): void {
    const cols = VAULT_CELLS.map((c) => c.col);
    const rows = VAULT_CELLS.map((c) => c.row);
    const minCol = Math.min(...cols);
    const maxCol = Math.max(...cols);
    const minRow = Math.min(...rows);
    const maxRow = Math.max(...rows);
    const width = maxCol - minCol + 1;
    const depth = maxRow - minRow + 1;
    const { x: minX, z: minZ } = cellToWorld({ col: minCol, row: minRow });

    const geometry = new THREE.BoxGeometry(width, 0.12, depth);
    const material = new THREE.MeshStandardMaterial({ color: VAULT_COLOR, roughness: 0.7 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(minX + (width - 1) / 2, 0.06, minZ + (depth - 1) / 2);
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

  private buildRobots(): Record<RobotColor, THREE.Mesh> {
    const geometry = new THREE.CylinderGeometry(ROBOT_RADIUS, ROBOT_RADIUS, ROBOT_HEIGHT, 24);
    const out = {} as Record<RobotColor, THREE.Mesh>;
    for (const color of ROBOT_COLORS) {
      const material = new THREE.MeshStandardMaterial({ color: ROBOT_HEX[color], roughness: 0.5 });
      const mesh = new THREE.Mesh(geometry, material);
      mesh.position.y = ROBOT_HEIGHT / 2;
      this.scene.add(mesh);
      out[color] = mesh;
    }
    return out;
  }

  private buildTargetMarker(): { mesh: THREE.Mesh; material: THREE.MeshBasicMaterial } {
    const geometry = new THREE.RingGeometry(0.24, 0.4, 32);
    const material = new THREE.MeshBasicMaterial({ color: ROBOT_HEX.red, side: THREE.DoubleSide });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.02;
    this.scene.add(mesh);
    return { mesh, material };
  }

  private buildHighlight(): THREE.Mesh {
    const geometry = new THREE.RingGeometry(0.38, 0.48, 32);
    const material = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = 0.03;
    mesh.visible = false;
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

  setTarget(target: Target): void {
    const { x, z } = cellToWorld(target.cell);
    this.targetMesh.position.x = x;
    this.targetMesh.position.z = z;
    this.targetMaterial.color.setHex(ROBOT_HEX[target.color]);
  }

  setSelected(color: RobotColor | null): void {
    if (!color) {
      this.highlightMesh.visible = false;
      return;
    }
    this.highlightMesh.visible = true;
    this.highlightMesh.position.x = this.robotMeshes[color].position.x;
    this.highlightMesh.position.z = this.robotMeshes[color].position.z;
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

  private applyAspect(aspect: number): void {
    this.camera.left = (-this.viewSize * aspect) / 2;
    this.camera.right = (this.viewSize * aspect) / 2;
    this.camera.top = this.viewSize / 2;
    this.camera.bottom = -this.viewSize / 2;
    this.camera.updateProjectionMatrix();
  }
}
