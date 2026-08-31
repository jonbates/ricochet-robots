import * as THREE from 'three';
import { Board, cellKey, type Direction, ROBOT_COLORS, type RobotColor, sameCell } from './board/Board';
import { buildBoardVariant, type BoardVariantId, randomInitialRobots, type Target } from './board/BoardLayout';
import { type Bid, GameState, type Player, type RoundPhase } from './game/GameState';
import { solve, type SolveResult } from './ai/Solver';
import { BoardRenderer } from './render/BoardRenderer';

export const WIN_SCORE = 5;

/** See revealSolution()'s doc comment -- how many moves deep the solver searches by default when no explicit depth is passed to the Game constructor. The user can raise or lower this (a "Search Depth" control on the start screen); higher finds longer solutions but risks a slower response, since a bounded-failure search (proving a target unreachable within the cap) is the expensive path. */
export const DEFAULT_SEARCH_DEPTH = 10;

export interface UpdateInfo {
  target: Target;
  moveCount: number;
  selected: RobotColor | null;
  players: Player[];
  phase: RoundPhase;
  bids: readonly Bid[]; // this round's bids so far, keyed by playerIndex
  bidCountdownMs: number | null; // null while no deadline is set yet
  activePlayerName: string | null; // whoever is currently attempting
  remainingMoves: number | null;
  roundWinnerName: string | null; // set once resolved, if anyone won
  /** True when the target robot is sitting on the target only because of a disallowed straight, unbent first move -- the real rule requires at least one ricochet, so this doesn't count as solved. */
  blockedByRicochetRule: boolean;
}

export interface GameCallbacks {
  onUpdate: (info: UpdateInfo) => void;
  onMatchOver: (winner: Player) => void;
}

const KEY_TO_DIRECTION: Record<string, Direction> = {
  ArrowUp: 'N',
  ArrowDown: 'S',
  ArrowLeft: 'W',
  ArrowRight: 'E',
};

/** Orchestrates input -> GameState -> BoardRenderer, and the bidding/attempting/resolved round lifecycle. */
export class Game {
  private readonly container: HTMLElement;
  private readonly callbacks: GameCallbacks;
  private readonly board: Board;
  private readonly targets: readonly Target[];
  private readonly renderer: THREE.WebGLRenderer;
  private readonly boardRenderer: BoardRenderer;
  private readonly raycaster = new THREE.Raycaster();
  private readonly searchDepth: number;
  private state: GameState;
  private running = false;
  private rafId = 0;
  private matchOverFired = false;

  constructor(
    container: HTMLElement,
    variantId: BoardVariantId,
    playerNames: readonly string[],
    callbacks: GameCallbacks,
    searchDepth: number = DEFAULT_SEARCH_DEPTH,
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.searchDepth = searchDepth;
    const variant = buildBoardVariant(variantId);
    this.board = new Board(variant.wallSegments, variant.deflectors);
    this.targets = variant.targets;
    const firstTarget = pickTarget(this.targets, null);
    this.state = new GameState(this.board, randomInitialRobots([firstTarget.cell]), firstTarget, playerNames);

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.boardRenderer = new BoardRenderer(this.board, this.targets);
    this.boardRenderer.setRobotPositions(this.state.robots);
    this.boardRenderer.setTarget(this.state.target);

    this.handleResize = this.handleResize.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);

    window.addEventListener('resize', this.handleResize);
    this.renderer.domElement.addEventListener('click', this.handleClick);
    window.addEventListener('keydown', this.handleKeydown);
    this.handleResize();
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      const phaseBefore = this.state.phase;
      this.state.tick(performance.now());
      if (this.state.phase !== phaseBefore) this.syncRobots();

      this.renderer.render(this.boardRenderer.scene, this.boardRenderer.camera);
      this.emitUpdate();
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

  placeBid(playerIndex: number, moves: number): void {
    this.state.placeBid(playerIndex, moves, performance.now());
  }

  /** Ends the 60s bidding window immediately instead of waiting it out. */
  endCountdownEarly(): void {
    this.state.endCountdownEarly(performance.now());
  }

  concede(): void {
    this.state.concede();
    this.syncRobots();
  }

  /** Gives up on the round entirely (from bidding or mid-attempt) and resolves it with no winner, so Reveal Optimal Solution becomes available without exhausting every backup bidder first. */
  giveUpRound(): void {
    this.state.giveUpRound();
    this.syncRobots();
  }

  undo(): void {
    if (this.state.undo()) this.syncRobots();
  }

  /**
   * Runs the true-optimal solver from the round's starting position. Bounded
   * at this.searchDepth (user-configurable, see DEFAULT_SEARCH_DEPTH) rather
   * than searching arbitrarily deep -- plain BFS blows up hard past ~10
   * moves on this denser board (one measured case: a genuine 12-move
   * solution took ~29s to find), so this trades "always finds the true
   * optimum" for "always responds quickly" at the default depth, and
   * returns null on the rare target that needs more moves than the
   * configured cap -- callers should show a graceful message rather than
   * assume this always succeeds. Every target stays fully playable
   * regardless: GameState's own move/isSolved logic has no depth limit at
   * all, this cap only affects whether the solver can *reveal* the answer
   * on request.
   */
  revealSolution(): SolveResult | null {
    try {
      const result = solve(this.board, this.state.roundStartRobots, this.state.target, this.searchDepth);
      this.boardRenderer.showSolutionPath(this.solutionPaths(result));
      return result;
    } catch {
      this.boardRenderer.clearSolutionPath();
      return null;
    }
  }

  /** Replays a solved move list to recover each move's actual on-board path (a deflector can bend it, so `from`/`to` alone don't describe the route) -- for drawing the dotted solution line. */
  private solutionPaths(result: SolveResult): { color: RobotColor; path: { col: number; row: number }[] }[] {
    const robots = { ...this.state.roundStartRobots };
    const paths: { color: RobotColor; path: { col: number; row: number }[] }[] = [];
    for (const move of result.moves) {
      const occupied = new Set<string>();
      for (const c of ROBOT_COLORS) {
        if (c !== move.color) occupied.add(cellKey(robots[c].col, robots[c].row));
      }
      paths.push({ color: move.color, path: this.board.slidePath(robots[move.color], move.direction, occupied, move.color) });
      robots[move.color] = move.to;
    }
    return paths;
  }

  /** Starts the next round once the current one is resolved. No-op otherwise. */
  continueToNextRound(): void {
    if (this.state.phase !== 'resolved') return;
    const winner = this.state.players.find((p) => p.score >= WIN_SCORE);
    if (winner) {
      if (!this.matchOverFired) {
        this.matchOverFired = true;
        this.callbacks.onMatchOver(winner);
      }
      return;
    }
    this.boardRenderer.clearSolutionPath();
    const nextTarget = pickTarget(this.targets, this.state.target);
    this.state.startNextRound(nextTarget);
    this.boardRenderer.setTarget(nextTarget);
    this.syncRobots();
  }

  resetMatch(playerNames: readonly string[]): void {
    this.matchOverFired = false;
    this.boardRenderer.clearSolutionPath();
    const firstTarget = pickTarget(this.targets, null);
    this.state = new GameState(this.board, randomInitialRobots([firstTarget.cell]), firstTarget, playerNames);
    this.boardRenderer.setTarget(this.state.target);
    this.syncRobots();
  }

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.renderer.setSize(width, height);
    this.boardRenderer.resize(width, height);
  }

  private handleClick(event: MouseEvent): void {
    if (this.state.phase !== 'attempting') return;
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
  }

  private handleKeydown(event: KeyboardEvent): void {
    const direction = KEY_TO_DIRECTION[event.key];
    if (direction) {
      event.preventDefault();
      if (this.state.move(direction)) {
        this.syncRobots();
        this.resolveAttemptIfNeeded();
      }
      return;
    }
    if (event.key === 'z' || event.key === 'Z') this.undo();
  }

  /** After a move during `attempting`: award success if the target's now satisfied, otherwise hand off to the next backup bidder once this one is out of moves. */
  private resolveAttemptIfNeeded(): void {
    if (this.state.phase !== 'attempting') return;
    if (this.state.isSolved()) {
      this.state.recordSuccess();
    } else if ((this.state.remainingMoves ?? 1) <= 0) {
      this.state.concede();
      this.syncRobots();
    }
  }

  /** Repositions robot meshes and keeps the selection ring glued to whichever robot is currently selected (a move can relocate the selected robot itself). */
  private syncRobots(): void {
    this.boardRenderer.setRobotPositions(this.state.robots);
    this.boardRenderer.setSelected(this.state.selected);
  }

  private emitUpdate(): void {
    const activeBid = this.state.activeBid;
    const activePlayerName = activeBid ? this.state.players[activeBid.playerIndex].name : null;
    const bidCountdownMs =
      this.state.bidDeadline === null ? null : Math.max(0, this.state.bidDeadline - performance.now());

    const roundWinnerName =
      this.state.lastRoundWinnerIndex === null ? null : this.state.players[this.state.lastRoundWinnerIndex].name;

    this.callbacks.onUpdate({
      target: this.state.target,
      moveCount: this.state.moveCount,
      selected: this.state.selected,
      players: this.state.players,
      phase: this.state.phase,
      bids: this.state.bids,
      bidCountdownMs,
      activePlayerName,
      remainingMoves: this.state.remainingMoves,
      roundWinnerName,
      blockedByRicochetRule: this.state.blockedByRicochetRule,
    });
  }
}

function pickTarget(targets: readonly Target[], exclude: Target | null): Target {
  const options = exclude ? targets.filter((t) => !sameCell(t.cell, exclude.cell)) : targets;
  return options[Math.floor(Math.random() * options.length)];
}
