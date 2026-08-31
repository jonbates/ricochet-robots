import * as THREE from 'three';
import { Board, type Direction, type RobotColor } from './board/Board';
import { INITIAL_ROBOTS, TARGETS, type Target, WALL_SEGMENTS } from './board/BoardLayout';
import { GameState } from './game/GameState';
import { AI_SEARCH_DEPTH, trySolve } from './ai/Solver';
import { BoardRenderer } from './render/BoardRenderer';

export const WIN_SCORE = 5;

export interface UpdateInfo {
  target: Target;
  moveCount: number;
  canSubmit: boolean;
  playerScore: number;
  aiScore: number;
  selected: RobotColor | null;
}

export interface RoundResult {
  playerMoves: number;
  /** null means the AI's search gave up within its budget (AI_SEARCH_DEPTH) without finding a solution -- the player wins the round outright. */
  aiMoves: number | null;
  winner: 'player' | 'ai' | 'draw';
}

export interface GameCallbacks {
  onUpdate: (info: UpdateInfo) => void;
  onRoundResult: (result: RoundResult) => void;
  onMatchOver: (winner: 'player' | 'ai') => void;
}

const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: 'N',
  ArrowDown: 'S',
  ArrowLeft: 'W',
  ArrowRight: 'E',
};

/** Orchestrates input -> GameState -> BoardRenderer, and the round/match lifecycle. */
export class Game {
  private readonly container: HTMLElement;
  private readonly callbacks: GameCallbacks;
  private readonly board: Board;
  private readonly renderer: THREE.WebGLRenderer;
  private readonly boardRenderer: BoardRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private state: GameState;
  private running = false;
  private rafId = 0;

  constructor(container: HTMLElement, callbacks: GameCallbacks) {
    this.container = container;
    this.callbacks = callbacks;
    this.board = new Board(WALL_SEGMENTS);
    this.state = new GameState(this.board, INITIAL_ROBOTS, pickTarget(null));

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.boardRenderer = new BoardRenderer(this.board);
    this.boardRenderer.setRobotPositions(this.state.robots);
    this.boardRenderer.setTarget(this.state.target);

    this.handleResize = this.handleResize.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);

    window.addEventListener('resize', this.handleResize);
    this.renderer.domElement.addEventListener('click', this.handleClick);
    window.addEventListener('keydown', this.handleKeydown);
    this.handleResize();

    this.emitUpdate();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      this.renderer.render(this.boardRenderer.scene, this.boardRenderer.camera);
      this.rafId = requestAnimationFrame(loop);
    };
    this.rafId = requestAnimationFrame(loop);
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  dispose(): void {
    this.stop();
    window.removeEventListener('resize', this.handleResize);
    window.removeEventListener('keydown', this.handleKeydown);
    this.renderer.domElement.removeEventListener('click', this.handleClick);
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  undo(): void {
    if (this.state.undo()) {
      this.syncRobots();
      this.emitUpdate();
    }
  }

  resetRound(): void {
    this.state.resetRound();
    this.syncRobots();
    this.emitUpdate();
  }

  /** Locks in the player's move count, reveals the AI's optimal solution, scores the round, and either advances to the next round or ends the match. Returns null if the target robot isn't actually on the target yet. */
  submit(): RoundResult | null {
    if (!this.state.isSolved()) return null;

    const playerMoves = this.state.moveCount;
    const aiResult = trySolve(this.board, this.state.roundStartRobots, this.state.target, AI_SEARCH_DEPTH);
    const aiMoves = aiResult ? aiResult.count : null;
    const winner: RoundResult['winner'] =
      aiMoves === null ? 'player' : playerMoves < aiMoves ? 'player' : playerMoves > aiMoves ? 'ai' : 'draw';
    if (winner === 'player') this.state.playerScore++;
    if (winner === 'ai') this.state.aiScore++;

    const result: RoundResult = { playerMoves, aiMoves, winner };
    this.callbacks.onRoundResult(result);

    if (this.state.playerScore >= WIN_SCORE || this.state.aiScore >= WIN_SCORE) {
      this.callbacks.onMatchOver(this.state.playerScore >= WIN_SCORE ? 'player' : 'ai');
      this.emitUpdate();
      return result;
    }

    const nextTarget = pickTarget(this.state.target.color);
    this.state.startNextRound(nextTarget);
    this.boardRenderer.setTarget(nextTarget);
    this.syncRobots();
    this.emitUpdate();
    return result;
  }

  resetMatch(): void {
    this.state = new GameState(this.board, INITIAL_ROBOTS, pickTarget(null));
    this.boardRenderer.setTarget(this.state.target);
    this.syncRobots();
    this.emitUpdate();
  }

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.renderer.setSize(width, height);
    this.boardRenderer.resize(width, height);
  }

  private handleClick(event: MouseEvent): void {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.boardRenderer.camera);
    const hits = this.raycaster.intersectObjects(this.boardRenderer.pickableRobotMeshes);
    const color = hits.length > 0 ? this.boardRenderer.robotColorAt(hits[0].object) : null;
    if (color) this.state.select(color);
    else this.state.deselect();
    this.boardRenderer.setSelected(this.state.selected);
    this.emitUpdate();
  }

  private handleKeydown(event: KeyboardEvent): void {
    const direction = KEY_TO_DIRECTION[event.key];
    if (direction) {
      event.preventDefault();
      if (this.state.move(direction)) {
        this.syncRobots();
        this.emitUpdate();
      }
      return;
    }
    if (event.key === 'z' || event.key === 'Z') this.undo();
    else if (event.key === 'r' || event.key === 'R') this.resetRound();
  }

  /** Repositions robot meshes and keeps the selection ring glued to whichever robot is currently selected (a move can relocate the selected robot itself). */
  private syncRobots(): void {
    this.boardRenderer.setRobotPositions(this.state.robots);
    this.boardRenderer.setSelected(this.state.selected);
  }

  private emitUpdate(): void {
    this.callbacks.onUpdate({
      target: this.state.target,
      moveCount: this.state.moveCount,
      canSubmit: this.state.isSolved(),
      playerScore: this.state.playerScore,
      aiScore: this.state.aiScore,
      selected: this.state.selected,
    });
  }
}

function pickTarget(exclude: RobotColor | null): Target {
  const options = TARGETS.filter((t) => t.color !== exclude);
  return options[Math.floor(Math.random() * options.length)];
}
