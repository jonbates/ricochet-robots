import { Vector2, WebGLRenderer } from 'three';
import { Board, type Cell, cellKey, type Direction, ROBOT_COLORS, type RobotColor, sameCell } from './board/Board';
import { buildBoardVariant, type BoardVariantId, type QuadrantAssignment, randomInitialRobots, type Target } from './board/BoardLayout';
import { type Bid, GameState, type Player, type RobotPositions, type RoundPhase } from './game/GameState';
import { solve, type SolveResult } from './ai/Solver';
import { BoardRenderer } from './render/BoardRenderer';
import type { NetworkRoom } from './net/room';
import type { ActionMsg, StateSnapshot } from './net/protocol';

export const WIN_SCORE = 5;

/** See revealSolution()'s doc comment -- how many moves deep the solver searches by default when no explicit depth is passed to the Game constructor. The user can raise or lower this (a "Search Depth" control on the start screen); higher finds longer solutions but risks a slower response, since a bounded-failure search (proving a target unreachable within the cap) is the expensive path. */
export const DEFAULT_SEARCH_DEPTH = 10;

export type NetRole = 'local' | 'host' | 'client';

/**
 * Multiplayer wiring, threaded through from main.ts's lobby flow. `role`
 * governs how GameState gets mutated (see start()/handleClick()/
 * handleKeydown() below): 'local' behaves exactly as before this feature
 * existed (any local input mutates GameState directly, nothing is
 * networked); 'host' mutates its own GameState directly too, but broadcasts
 * a fresh StateSnapshot after every mutation and applies incoming client
 * action requests; 'client' never mutates GameState from local input at all
 * -- it only ever applies whatever the host's snapshots say, and forwards
 * local input as action requests instead of touching GameState itself.
 * `playerOrder[i]` is the peer controlling `players[i]` (host's own selfId
 * included, like any other peer); `mySlot` is this instance's own index
 * into it (null for `local`).
 */
export interface NetworkContext {
  role: NetRole;
  room: NetworkRoom | null;
  playerOrder: readonly string[];
  mySlot: number | null;
}

export const LOCAL_NETWORK_CONTEXT: NetworkContext = { role: 'local', room: null, playerOrder: [], mySlot: null };

/**
 * Everything the host resolves once and transmits (via StartMatchMsg) so
 * every peer builds an identical starting Board/GameState with no further
 * randomness of its own -- closes off the three unseeded Math.random() call
 * sites (randomQuadrantAssignment, randomInitialRobots, pickTarget) that
 * would otherwise make each peer's board diverge from round zero. Passed by
 * main.ts's lobby flow for 'host'/'client' roles; omitted for 'local',
 * which falls back to the existing randomized defaults.
 */
export interface MatchStart {
  quadrantAssignment: QuadrantAssignment;
  initialRobots: RobotPositions;
  firstTarget: Target;
}

export interface UpdateInfo {
  target: Target;
  moveCount: number;
  selected: RobotColor | null;
  players: Player[];
  phase: RoundPhase;
  bids: readonly Bid[]; // this round's bids so far, keyed by playerIndex
  bidCountdownMs: number | null; // null while no deadline is set yet
  activePlayerName: string | null; // whoever is currently attempting
  activeBidPlayerIndex: number | null; // same turn as activePlayerName, but by index -- lets the UI compare against mySlot without relying on player names, which aren't guaranteed unique
  activeBidMoves: number | null; // the active bidder's declared move count -- remainingMoves counts down from this
  remainingMoves: number | null;
  roundWinnerName: string | null; // set once resolved, if anyone won
  /** True when the target robot is sitting on the target only because of a disallowed straight, unbent first move -- the real rule requires at least one ricochet, so this doesn't count as solved. */
  blockedByRicochetRule: boolean;
  /** This instance's own player index in a networked match; null in local hot-seat play. */
  mySlot: number | null;
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
  private readonly renderer: WebGLRenderer;
  private readonly boardRenderer: BoardRenderer;
  private readonly resizeObserver: ResizeObserver;
  private readonly searchDepth: number;
  private readonly net: NetworkContext;
  private state: GameState;
  private running = false;
  private rafId = 0;
  private usingTimeout = false;
  private matchOverFired = false;
  private lastBidCountdownMs: number | null = null;
  private lastHeartbeatAt = 0;
  /** Whether any peer has revealed the optimal solution this round -- see revealSolution()'s doc comment. Reset wherever a fresh round begins. */
  private revealed = false;

  constructor(
    container: HTMLElement,
    variantId: BoardVariantId,
    playerNames: readonly string[],
    callbacks: GameCallbacks,
    searchDepth: number = DEFAULT_SEARCH_DEPTH,
    net: NetworkContext = LOCAL_NETWORK_CONTEXT,
    matchStart?: MatchStart,
  ) {
    this.container = container;
    this.callbacks = callbacks;
    this.searchDepth = searchDepth;
    this.net = net;
    const variant = buildBoardVariant(variantId, matchStart?.quadrantAssignment);
    this.board = new Board(variant.wallSegments, variant.deflectors);
    this.targets = variant.targets;
    const firstTarget = matchStart?.firstTarget ?? pickTarget(this.targets, null);
    const initialRobots = matchStart?.initialRobots ?? randomInitialRobots([firstTarget.cell]);
    this.state = new GameState(this.board, initialRobots, firstTarget, playerNames);

    this.renderer = new WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.container.appendChild(this.renderer.domElement);

    this.boardRenderer = new BoardRenderer(this.board, this.targets);
    this.boardRenderer.setRobotPositions(this.state.robots);
    this.boardRenderer.setTarget(this.state.target);

    this.handleResize = this.handleResize.bind(this);
    this.handleClick = this.handleClick.bind(this);
    this.handleKeydown = this.handleKeydown.bind(this);
    this.handleVisibilityChange = this.handleVisibilityChange.bind(this);

    // A ResizeObserver on the container itself, not a `window` resize
    // listener -- #board-area's own on-screen size can change for reasons
    // that never fire a window resize event at all (e.g. #hud-top-strip/
    // #hud-bottom-strip growing or shrinking to fit their content as the
    // round's phase changes, which reflows #board-area since it's the
    // flex-1 sibling soaking up whatever space is left). Missing one of
    // those left the renderer/camera sized for a stale container box while
    // the canvas's actual CSS size (and getBoundingClientRect(), which
    // handleClick's raycast math reads) had already moved on -- clicks
    // would raycast against the wrong screen location and silently miss
    // every robot.
    this.resizeObserver = new ResizeObserver(this.handleResize);
    this.resizeObserver.observe(this.container);
    this.renderer.domElement.addEventListener('click', this.handleClick);
    window.addEventListener('keydown', this.handleKeydown);
    // A backgrounded tab can suspend ResizeObserver notifications (and
    // rAF) same as it suspends the render loop itself -- if the container
    // was resized while hidden, the renderer/camera (and the --board-width
    // CSS var the HUD strips align to) can still be stale by the time the
    // tab is visible again, breaking click hit-testing and the mobile
    // D-pad's apparent position until something else happens to trigger a
    // resize. Force a resync the moment it comes back.
    document.addEventListener('visibilitychange', this.handleVisibilityChange);
    this.handleResize();

    if (this.net.room) {
      if (this.net.role === 'host') {
        this.net.room.action.onMessage = (msg, ctx) => this.handleIncomingAction(msg, ctx.peerId);
        this.broadcastState(); // an immediate first snapshot, even though every peer's initial GameState is already provably identical from `matchStart` -- cheap belt-and-suspenders
      } else if (this.net.role === 'client') {
        this.net.room.state.onMessage = (snapshot) => this.applySnapshot(snapshot);
      }
    }
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    const loop = () => {
      if (!this.running) return;
      // A client never runs its own GameState.tick() -- its bidDeadline is
      // never set (see applySnapshot), and the bidding->attempting
      // transition is purely something the host decides and broadcasts.
      if (this.net.role !== 'client') {
        const phaseBefore = this.state.phase;
        this.state.tick(performance.now());
        if (this.state.phase !== phaseBefore) {
          this.syncRobots();
          this.broadcastState();
        }
        this.maybeBroadcastHeartbeat();
      }

      this.renderer.render(this.boardRenderer.scene, this.boardRenderer.camera);
      this.emitUpdate();
      this.scheduleNextFrame(loop);
    };
    this.scheduleNextFrame(loop);
  }

  /**
   * requestAnimationFrame is fully suspended by the browser while a tab is
   * backgrounded -- fine for local play (the match just visibly pauses), but
   * fatal for a host/client match: the host's tick() also drives the
   * bidding countdown/attempting-phase transition for every connected peer,
   * so it must keep advancing even while the host's own tab is hidden.
   */
  private scheduleNextFrame(loop: () => void): void {
    if (this.net.role !== 'local' && document.hidden) {
      this.usingTimeout = true;
      this.rafId = window.setTimeout(loop, 1000 / 30) as unknown as number;
    } else {
      this.usingTimeout = false;
      this.rafId = requestAnimationFrame(loop);
    }
  }

  /** While a bid countdown is running, the host re-broadcasts on a small heartbeat purely so the remaining-ms display keeps ticking down on other peers' screens between real state changes. */
  private maybeBroadcastHeartbeat(): void {
    if (this.net.role !== 'host') return;
    if (this.state.phase !== 'bidding' || this.state.bidDeadline === null) return;
    const now = performance.now();
    if (now - this.lastHeartbeatAt < 250) return;
    this.lastHeartbeatAt = now;
    this.broadcastState();
  }

  stop(): void {
    this.running = false;
    if (this.usingTimeout) clearTimeout(this.rafId);
    else cancelAnimationFrame(this.rafId);
  }

  dispose(): void {
    this.stop();
    this.resizeObserver.disconnect();
    document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    window.removeEventListener('keydown', this.handleKeydown);
    this.renderer.domElement.removeEventListener('click', this.handleClick);
    this.renderer.dispose();
    this.container.removeChild(this.renderer.domElement);
  }

  /** True if this instance is allowed to act as whoever's turn it currently is -- always true for local hot-seat play (one shared keyboard); for a networked match, only the peer occupying the active bidder's slot. */
  private canActNow(): boolean {
    if (this.net.role === 'local') return true;
    const activeBid = this.state.activeBid;
    return activeBid !== null && this.net.mySlot === activeBid.playerIndex;
  }

  placeBid(playerIndex: number, moves: number): void {
    if (this.net.role === 'client') {
      if (this.net.mySlot !== playerIndex) return;
      void this.net.room?.action.send({ type: 'placeBid', moves });
      return;
    }
    // A host's own local UI only ever offers its own slot's bid button -- this is defense in depth, not the primary gate.
    if (this.net.role === 'host' && this.net.mySlot !== null && playerIndex !== this.net.mySlot) return;
    this.state.placeBid(playerIndex, moves, performance.now());
    this.broadcastState();
  }

  /** Ends the 60s bidding window immediately instead of waiting it out. Any connected player may do this, not just the active bidder. */
  endCountdownEarly(): void {
    if (this.net.role === 'client') {
      void this.net.room?.action.send({ type: 'endCountdownEarly' });
      return;
    }
    this.state.endCountdownEarly(performance.now());
    this.broadcastState();
  }

  concede(): void {
    if (!this.canActNow()) return;
    if (this.net.role === 'client') {
      void this.net.room?.action.send({ type: 'concede' });
      return;
    }
    this.state.concede();
    this.syncRobots();
    this.broadcastState();
  }

  /** Gives up on the round entirely (from bidding or mid-attempt) and resolves it with no winner, so Reveal Optimal Solution becomes available without exhausting every backup bidder first. Any connected player may do this. */
  giveUpRound(): void {
    if (this.net.role === 'client') {
      void this.net.room?.action.send({ type: 'giveUpRound' });
      return;
    }
    this.state.giveUpRound();
    this.syncRobots();
    this.broadcastState();
  }

  undo(): void {
    if (!this.canActNow()) return;
    if (this.net.role === 'client') {
      void this.net.room?.action.send({ type: 'undo' });
      return;
    }
    if (this.state.undo()) {
      this.syncRobots();
      this.broadcastState();
    }
  }

  /**
   * Runs the true-optimal solver from the round's starting position. Needs
   * no networking of its own even in a multiplayer match to *compute* the
   * answer -- it's a pure function of (board, roundStartRobots, target), all
   * of which are already identical on every peer (the board via the
   * match-start message, roundStartRobots/target via every state snapshot),
   * so every peer just runs it locally and draws it on their own board
   * immediately, with no round-trip latency for whoever actually clicked
   * Reveal. What *does* need to cross the network is the fact that it's been
   * revealed at all -- see the `revealed` field and StateSnapshot's own doc
   * comment -- so every other connected peer's board picks up the same
   * overlay (and clears its own stale attempt trail) without needing to
   * click Reveal themselves.
   *
   * Bounded at this.searchDepth (user-configurable, see DEFAULT_SEARCH_DEPTH)
   * rather than searching arbitrarily deep -- plain BFS blows up hard past
   * ~10 moves on this denser board (one measured case: a genuine 12-move
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
    const result = this.computeAndDrawSolution();
    this.revealed = true;
    if (this.net.role === 'client') void this.net.room?.action.send({ type: 'revealSolution' });
    else this.broadcastState();
    return result;
  }

  private computeAndDrawSolution(): SolveResult | null {
    try {
      const result = solve(this.board, this.state.roundStartRobots, this.state.target, this.searchDepth);
      this.boardRenderer.showSolutionPath(this.pathsForMoves(result.moves));
      // Clears the round's own attempt trail rather than leaving it drawn
      // alongside the optimal one -- the two competing on the board at once
      // read as more confusing than helpful.
      this.boardRenderer.clearMoveTrail();
      return result;
    } catch {
      this.boardRenderer.clearSolutionPath();
      return null;
    }
  }

  /** Replays a move list (the solver's proposed solution, or the round's actual moveHistory so far) from the round's starting position to recover each move's actual on-board path -- a deflector can bend it, so `to` alone doesn't describe the route -- for drawing a dashed line per move. */
  private pathsForMoves(
    moves: readonly { color: RobotColor; to: Cell; direction: Direction }[],
  ): { color: RobotColor; path: { col: number; row: number }[] }[] {
    const robots = { ...this.state.roundStartRobots };
    const paths: { color: RobotColor; path: { col: number; row: number }[] }[] = [];
    for (const move of moves) {
      const occupied = new Set<string>();
      for (const c of ROBOT_COLORS) {
        if (c !== move.color) occupied.add(cellKey(robots[c].col, robots[c].row));
      }
      paths.push({ color: move.color, path: this.board.slidePath(robots[move.color], move.direction, occupied, move.color) });
      robots[move.color] = move.to;
    }
    return paths;
  }

  /** Starts the next round once the current one is resolved. No-op otherwise. Any connected player may trigger it. */
  continueToNextRound(): void {
    if (this.state.phase !== 'resolved') return;
    // Reads only already-synced state (players/scores), so this check -- and
    // firing onMatchOver -- is identical for every role, including 'client':
    // no round-trip needed to know the match just ended.
    const winner = this.state.players.find((p) => p.score >= WIN_SCORE);
    if (winner) {
      if (!this.matchOverFired) {
        this.matchOverFired = true;
        this.callbacks.onMatchOver(winner);
      }
      return;
    }
    if (this.net.role === 'client') {
      void this.net.room?.action.send({ type: 'continueToNextRound' });
      return;
    }
    this.boardRenderer.clearSolutionPath();
    this.revealed = false;
    const nextTarget = pickTarget(this.targets, this.state.target);
    this.state.startNextRound(nextTarget);
    this.boardRenderer.setTarget(nextTarget);
    this.syncRobots();
    this.broadcastState();
  }

  resetMatch(playerNames: readonly string[]): void {
    if (this.net.role === 'client') {
      void this.net.room?.action.send({ type: 'playAgain' });
      return;
    }
    this.matchOverFired = false;
    this.boardRenderer.clearSolutionPath();
    this.revealed = false;
    const firstTarget = pickTarget(this.targets, null);
    this.state = new GameState(this.board, randomInitialRobots([firstTarget.cell]), firstTarget, playerNames);
    this.boardRenderer.setTarget(this.state.target);
    this.syncRobots();
    this.broadcastState();
  }

  private handleResize(): void {
    const width = this.container.clientWidth;
    const height = this.container.clientHeight;
    this.renderer.setSize(width, height);
    this.boardRenderer.resize(width, height);
    // The board's own on-screen width matches the *container's* width only
    // when the container is narrower than tall (stacked mobile -- see
    // BoardRenderer.applyAspect, which pins the full board width in that
    // case); otherwise the board doesn't fill the container's full width,
    // so publish its actual rendered width as a CSS variable on the shared
    // parent instead, so sibling HUD elements (the timer/target strip above
    // the board) can align with the board rather than the wider container.
    const boardWidth = width / height >= 1 ? height * this.boardRenderer.boardToViewRatio : width;
    this.container.parentElement?.style.setProperty('--board-width', `${boardWidth}px`);
  }

  private handleVisibilityChange(): void {
    if (document.hidden) return;
    this.handleResize();
  }

  /** Which robot (if any) a screen point should select -- shared by handleClick and selectRobotAtPoint. Pure: no side effects. */
  private robotColorAtPoint(clientX: number, clientY: number): RobotColor | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new Vector2(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -((clientY - rect.top) / rect.height) * 2 + 1,
    );
    return this.boardRenderer.robotAt(ndc, this.state.robots);
  }

  private handleClick(event: MouseEvent): void {
    if (this.state.phase !== 'attempting') return;
    if (!this.canActNow()) return;
    const color = this.robotColorAtPoint(event.clientX, event.clientY);

    if (this.net.role === 'client') {
      void this.net.room?.action.send(color ? { type: 'select', color } : { type: 'deselect' });
      return;
    }
    if (color) this.state.select(color);
    else this.state.deselect();
    this.boardRenderer.setSelected(this.state.selected);
    this.broadcastState();
  }

  /**
   * Selects whatever robot occupies the board cell under a screen point,
   * exactly as a direct click on the board would -- used by the mobile
   * D-pad (see main.ts) to "click through" itself onto a robot sitting
   * visibly underneath its translucent background, rather than always
   * treating a tap there as a directional move. Returns false with no side
   * effect at all (notably, it does *not* deselect) when there's no robot
   * at that point, so the D-pad can fall back to its own move in that case.
   */
  selectRobotAtPoint(clientX: number, clientY: number): boolean {
    if (this.state.phase !== 'attempting' || !this.canActNow()) return false;
    const color = this.robotColorAtPoint(clientX, clientY);
    if (!color) return false;
    if (this.net.role === 'client') {
      void this.net.room?.action.send({ type: 'select', color });
    } else {
      this.state.select(color);
      this.boardRenderer.setSelected(this.state.selected);
      this.broadcastState();
    }
    return true;
  }

  private handleKeydown(event: KeyboardEvent): void {
    const direction = KEY_TO_DIRECTION[event.key];
    if (direction) {
      event.preventDefault();
      this.move(direction);
      return;
    }
    if (event.key === 'z' || event.key === 'Z') this.undo();
  }

  /** Attempts to slide the currently selected robot one step in `direction` -- shared by arrow-key input and the on-screen mobile D-pad (see main.ts). No-op if it isn't this instance's turn (see canActNow) or no robot is selected. */
  move(direction: Direction): void {
    if (!this.canActNow()) return;
    if (this.net.role === 'client') {
      void this.net.room?.action.send({ type: 'move', direction });
      return;
    }
    if (this.state.move(direction)) {
      this.syncRobots();
      this.broadcastState();
      this.resolveAttemptIfNeeded();
    }
  }

  /** After a move during `attempting`: award success if the target's now satisfied, otherwise hand off to the next backup bidder once this one is out of moves. Only ever called from the host/local mutation paths -- a client never calls state.move() directly, so never reaches this. */
  private resolveAttemptIfNeeded(): void {
    if (this.state.phase !== 'attempting') return;
    if (this.state.isSolved()) {
      this.state.recordSuccess();
      this.broadcastState();
    } else if ((this.state.remainingMoves ?? 1) <= 0) {
      this.state.concede();
      this.syncRobots();
      this.broadcastState();
    }
  }

  /**
   * Host-only: applies an action request from a connected client. The
   * sender's playerIndex is resolved from playerOrder (matched against the
   * peerId Trystero attaches to the incoming message), never trusted from
   * the message itself, so a client can't spoof another player's slot.
   * move/select/deselect/undo/concede are further gated to "is it actually
   * this sender's turn" -- placeBid/endCountdownEarly/giveUpRound/
   * continueToNextRound/playAgain/revealSolution are open to any connected
   * player, matching the same "anyone at the shared keyboard" spirit local
   * hot-seat play has for those actions.
   */
  private handleIncomingAction(msg: ActionMsg, peerId: string): void {
    const senderIndex = this.net.playerOrder.indexOf(peerId);
    if (senderIndex === -1) return; // not a recognized player in this match
    const isSendersTurn = this.state.activeBid?.playerIndex === senderIndex;

    switch (msg.type) {
      case 'placeBid':
        this.state.placeBid(senderIndex, msg.moves, performance.now());
        this.broadcastState();
        return;
      case 'select':
        if (!isSendersTurn) return;
        this.state.select(msg.color);
        this.boardRenderer.setSelected(this.state.selected);
        this.broadcastState();
        return;
      case 'deselect':
        if (!isSendersTurn) return;
        this.state.deselect();
        this.boardRenderer.setSelected(this.state.selected);
        this.broadcastState();
        return;
      case 'move':
        if (!isSendersTurn) return;
        if (this.state.move(msg.direction)) {
          this.syncRobots();
          this.broadcastState();
          this.resolveAttemptIfNeeded();
        }
        return;
      case 'undo':
        if (!isSendersTurn) return;
        if (this.state.undo()) {
          this.syncRobots();
          this.broadcastState();
        }
        return;
      case 'concede':
        if (!isSendersTurn) return;
        this.state.concede();
        this.syncRobots();
        this.broadcastState();
        return;
      case 'endCountdownEarly':
        this.state.endCountdownEarly(performance.now());
        this.broadcastState();
        return;
      case 'giveUpRound':
        this.state.giveUpRound();
        this.syncRobots();
        this.broadcastState();
        return;
      case 'continueToNextRound':
        this.continueToNextRound();
        return;
      case 'playAgain':
        this.resetMatch(this.state.players.map((p) => p.name));
        return;
      case 'revealSolution':
        this.revealed = true;
        this.broadcastState();
        return;
    }
  }

  /** Host-only: broadcasts the entire current GameState. A no-op for 'local'/'client' roles -- called unconditionally from every mutation site above rather than guarding each call site individually. */
  private broadcastState(): void {
    if (this.net.role !== 'host' || !this.net.room) return;
    const bidCountdownMs = this.state.bidDeadline === null ? null : Math.max(0, this.state.bidDeadline - performance.now());
    const snapshot: StateSnapshot = {
      robots: cloneRobotPositions(this.state.robots),
      roundStartRobots: cloneRobotPositions(this.state.roundStartRobots),
      moveHistory: this.state.moveHistory.map((m) => ({ ...m })),
      selected: this.state.selected,
      target: this.state.target,
      players: this.state.players.map((p) => ({ ...p })),
      phase: this.state.phase,
      bids: this.state.bids.map((b) => ({ ...b })),
      activeBidIndex: this.state.activeBidIndex,
      lastRoundWinnerIndex: this.state.lastRoundWinnerIndex,
      bidCountdownMs,
      revealed: this.revealed,
    };
    void this.net.room.state.send(snapshot);
  }

  /**
   * Client-only: applies a freshly received snapshot directly onto this
   * instance's own (otherwise-inert) GameState -- overwriting its fields
   * rather than replaying mutator calls, so every existing getter
   * (activeBid, remainingMoves, blockedByRicochetRule, isSolved, ...) and
   * every existing render path (syncRobots, pathsForMoves, emitUpdate) keeps
   * working unchanged, exactly as it does for the host's own live GameState.
   *
   * `players` is updated in place (mutating each existing Player object)
   * rather than replaced with the freshly-deserialized array wholesale --
   * main.ts's HUD only rebuilds the player rows (including each row's bid
   * input/button) when `info.players` changes *reference*, and a client
   * receives a fresh snapshot up to ~4x/sec during a live bid countdown (the
   * host's heartbeat, see maybeBroadcastHeartbeat). Replacing the array on
   * every one of those tore down and rebuilt every bid input/button under a
   * backup bidder's own click roughly every quarter second, so a click's
   * mousedown and mouseup could land on two different button instances and
   * get silently dropped -- exactly the failure mode buildPlayerRows's own
   * comment in main.ts already documents for local play, just triggered here
   * by the network snapshot cadence instead of a per-frame rebuild. `target`
   * gets the same treatment for the same reason (a stable reference lets
   * main.ts skip re-drawing its canvas icon on every heartbeat), just
   * conditioned on an actual value change instead of a field-by-field merge,
   * since a whole new Target object is cheap and correct either way.
   */
  private applySnapshot(snapshot: StateSnapshot): void {
    const targetChanged =
      this.state.target.color !== snapshot.target.color || !sameCell(this.state.target.cell, snapshot.target.cell);
    const revealedChanged = snapshot.revealed !== this.revealed;
    this.state.robots = cloneRobotPositions(snapshot.robots);
    this.state.roundStartRobots = cloneRobotPositions(snapshot.roundStartRobots);
    this.state.moveHistory = snapshot.moveHistory.map((m) => ({ ...m }));
    this.state.selected = snapshot.selected;
    if (targetChanged) this.state.target = snapshot.target;
    if (this.state.players.length === snapshot.players.length) {
      snapshot.players.forEach((p, i) => Object.assign(this.state.players[i], p));
    } else {
      this.state.players = snapshot.players.map((p) => ({ ...p }));
    }
    this.state.phase = snapshot.phase;
    this.state.bids = snapshot.bids.map((b) => ({ ...b }));
    this.state.activeBidIndex = snapshot.activeBidIndex;
    this.state.lastRoundWinnerIndex = snapshot.lastRoundWinnerIndex;
    this.lastBidCountdownMs = snapshot.bidCountdownMs;
    this.revealed = snapshot.revealed;
    if (targetChanged) this.boardRenderer.setTarget(this.state.target);
    this.syncRobots();
    if (revealedChanged) {
      if (this.revealed) this.computeAndDrawSolution();
      else this.boardRenderer.clearSolutionPath();
    }
  }

  /** Repositions robot meshes, keeps the selection ring glued to whichever robot is currently selected (a move can relocate the selected robot itself), and redraws the numbered move trail for the round's current attempt -- an empty moveHistory (a fresh bidder's turn, or giving up) just clears it. */
  private syncRobots(): void {
    this.boardRenderer.setRobotPositions(this.state.robots);
    this.boardRenderer.setSelected(this.state.selected);
    this.boardRenderer.showMoveTrail(this.pathsForMoves(this.state.moveHistory));
  }

  private emitUpdate(): void {
    const activeBid = this.state.activeBid;
    const activePlayerName = activeBid ? this.state.players[activeBid.playerIndex].name : null;
    const bidCountdownMs =
      this.net.role === 'client'
        ? this.lastBidCountdownMs
        : this.state.bidDeadline === null
          ? null
          : Math.max(0, this.state.bidDeadline - performance.now());

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
      activeBidPlayerIndex: activeBid?.playerIndex ?? null,
      activeBidMoves: activeBid?.moves ?? null,
      remainingMoves: this.state.remainingMoves,
      roundWinnerName,
      blockedByRicochetRule: this.state.blockedByRicochetRule,
      mySlot: this.net.mySlot,
    });
  }
}

/** Exported for main.ts's online-lobby "Start Game" flow -- the host must resolve the first round's target itself (one of the three Math.random() call sites that would otherwise desync every peer's board, see MatchStart) before constructing its Game instance. */
export function pickTarget(targets: readonly Target[], exclude: Target | null): Target {
  const options = exclude ? targets.filter((t) => !sameCell(t.cell, exclude.cell)) : targets;
  return options[Math.floor(Math.random() * options.length)];
}

function cloneRobotPositions(robots: RobotPositions): RobotPositions {
  const out = {} as RobotPositions;
  for (const c of ROBOT_COLORS) out[c] = { ...robots[c] };
  return out;
}
