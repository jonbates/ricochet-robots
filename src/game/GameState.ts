import { type Board, cellKey, type Cell, type Direction, isStraightPath, ROBOT_COLORS, type RobotColor, sameCell } from '../board/Board';
import type { Target } from '../board/BoardLayout';

export interface Move {
  color: RobotColor;
  from: Cell;
  to: Cell;
  /** The direction actually pressed/chosen -- kept because a deflector can bend the path, so `to` isn't always a simple cardinal projection of `from` (both its row and column can change), meaning the initial direction can't be reliably re-derived from the endpoints alone. */
  direction: Direction;
}

export type RobotPositions = Record<RobotColor, Cell>;

export interface Player {
  name: string;
  score: number;
}

export interface Bid {
  playerIndex: number;
  moves: number;
}

export type RoundPhase = 'bidding' | 'attempting' | 'resolved';

const BID_WINDOW_MS = 60_000;

/**
 * Robot positions, the bidding/attempting/resolved round state machine, and
 * player scores -- all pure state, no rendering. Round flow: players bid a
 * move count during `bidding` (first bid starts the 60s window); once the
 * window closes, the lowest bidder gets to actually move robots during
 * `attempting`, and must land on the target within their declared count or
 * the next-lowest backup bidder gets a fresh attempt from the same starting
 * position; `resolved` is the outcome, shown until the next round starts.
 */
export class GameState {
  robots: RobotPositions;
  roundStartRobots: RobotPositions;
  moveHistory: Move[] = [];
  selected: RobotColor | null = null;
  target: Target;
  players: Player[];
  phase: RoundPhase = 'bidding';
  bids: Bid[] = [];
  bidDeadline: number | null = null;
  activeBidIndex: number | null = null;
  /** Set by recordSuccess(), cleared by startNextRound() -- who (if anyone) won the round now sitting in `resolved`. */
  lastRoundWinnerIndex: number | null = null;
  private readonly board: Board;

  constructor(board: Board, initialRobots: RobotPositions, initialTarget: Target, playerNames: readonly string[]) {
    this.board = board;
    this.robots = cloneRobots(initialRobots);
    this.roundStartRobots = cloneRobots(initialRobots);
    this.target = initialTarget;
    this.players = playerNames.map((name) => ({ name, score: 0 }));
  }

  // -- Bidding ---------------------------------------------------------

  /** Places or replaces `playerIndex`'s bid. The first bid of the round starts the 60s window. No-op outside the bidding phase. */
  placeBid(playerIndex: number, moves: number, now: number): void {
    if (this.phase !== 'bidding' || moves < 0) return;
    const existing = this.bids.find((b) => b.playerIndex === playerIndex);
    if (existing) existing.moves = moves;
    else this.bids.push({ playerIndex, moves });
    if (this.bidDeadline === null) this.bidDeadline = now + BID_WINDOW_MS;
  }

  /** Ends the bidding window immediately instead of waiting out the full 60s -- a no-op if no one has bid yet, since there'd be nothing to resolve to. */
  endCountdownEarly(now: number): void {
    if (this.phase !== 'bidding' || this.bidDeadline === null) return;
    this.bidDeadline = now;
  }

  /** Call once per frame; transitions bidding -> attempting once the deadline has passed. */
  tick(now: number): void {
    if (this.phase !== 'bidding' || this.bidDeadline === null || now < this.bidDeadline) return;
    this.bids.sort((a, b) => a.moves - b.moves);
    this.phase = 'attempting';
    this.activeBidIndex = 0;
    this.robots = cloneRobots(this.roundStartRobots);
    this.moveHistory = [];
    this.selected = null;
  }

  get activeBid(): Bid | null {
    return this.activeBidIndex === null ? null : (this.bids[this.activeBidIndex] ?? null);
  }

  get remainingMoves(): number | null {
    const bid = this.activeBid;
    return bid === null ? null : bid.moves - this.moveHistory.length;
  }

  /** The active bidder gives up early, or has just run out of moves without solving -- either way, hands off to the next backup bidder, or resolves with no winner if there isn't one. */
  concede(): void {
    if (this.phase !== 'attempting' || this.activeBidIndex === null) return;
    const nextIndex = this.activeBidIndex + 1;
    if (nextIndex < this.bids.length) {
      this.activeBidIndex = nextIndex;
      this.robots = cloneRobots(this.roundStartRobots);
      this.moveHistory = [];
      this.selected = null;
    } else {
      this.activeBidIndex = null;
      this.phase = 'resolved';
    }
  }

  /**
   * Gives up on the round entirely -- from bidding (nobody wants to commit)
   * or mid-attempt (skip the rest of the backup queue) -- and resolves it
   * with no winner, straight to where Reveal Optimal Solution is available.
   * Distinct from concede(): that only fails the *current* bidder and hands
   * off to the next backup; this ends the round outright.
   */
  giveUpRound(): void {
    if (this.phase === 'resolved') return;
    this.robots = cloneRobots(this.roundStartRobots);
    this.moveHistory = [];
    this.selected = null;
    this.activeBidIndex = null;
    this.lastRoundWinnerIndex = null;
    this.phase = 'resolved';
  }

  // -- Robot movement (only meaningful during `attempting`) ------------

  select(color: RobotColor): void {
    if (this.phase !== 'attempting') return;
    this.selected = color;
  }

  deselect(): void {
    this.selected = null;
  }

  occupiedExcept(color: RobotColor): Set<string> {
    const occupied = new Set<string>();
    for (const c of ROBOT_COLORS) {
      if (c !== color) occupied.add(cellKey(this.robots[c].col, this.robots[c].row));
    }
    return occupied;
  }

  /** Slides the selected robot. Returns false (no-op) if nothing is selected, out of moves, not the attempting phase, or the robot can't move that way. */
  move(direction: Direction): boolean {
    if (this.phase !== 'attempting' || !this.selected) return false;
    if ((this.remainingMoves ?? 0) <= 0) return false;
    const color = this.selected;
    const from = this.robots[color];
    const to = this.board.slideDestination(from, direction, this.occupiedExcept(color), color);
    if (sameCell(from, to)) return false;
    this.robots[color] = to;
    this.moveHistory.push({ color, from, to, direction });
    return true;
  }

  undo(): boolean {
    if (this.phase !== 'attempting') return false;
    const last = this.moveHistory.pop();
    if (!last) return false;
    this.robots[last.color] = last.from;
    return true;
  }

  get moveCount(): number {
    return this.moveHistory.length;
  }

  private isOnTargetCell(): boolean {
    return this.target.color === 'warp'
      ? ROBOT_COLORS.some((c) => sameCell(this.robots[c], this.target.cell))
      : sameCell(this.robots[this.target.color], this.target.cell);
  }

  /**
   * True if any robot required by the active target (any robot at all for a
   * warp target, the matching-color one otherwise) is on the target cell --
   * except a single straight, unbent first move that happens to land there
   * doesn't count (see blockedByRicochetRule). Per the real rule, a robot
   * that was already lined up for a direct shot must take another
   * (ricocheting) route instead; every longer sequence already implies at
   * least one stop-and-turn along the way, so this only needs to check the
   * one-move case.
   */
  isSolved(): boolean {
    return this.isOnTargetCell() && !this.blockedByRicochetRule;
  }

  /** True exactly when the robot is sitting on the target only because of a single disallowed straight shot -- lets the UI flag *why* nothing happened, rather than just not winning silently. */
  get blockedByRicochetRule(): boolean {
    return this.isOnTargetCell() && this.moveHistory.length === 1 && this.wasTrivialStraightShot(this.moveHistory[0]);
  }

  private wasTrivialStraightShot(move: Move): boolean {
    const occupied = new Set<string>();
    for (const c of ROBOT_COLORS) {
      if (c !== move.color) occupied.add(cellKey(this.roundStartRobots[c].col, this.roundStartRobots[c].row));
    }
    const path = this.board.slidePath(move.from, move.direction, occupied, move.color);
    return isStraightPath(path);
  }

  /** Call once `isSolved()` is true during `attempting`: awards the active bidder's player a point and resolves the round. */
  recordSuccess(): void {
    const bid = this.activeBid;
    if (this.phase !== 'attempting' || !bid) return;
    this.players[bid.playerIndex].score++;
    this.lastRoundWinnerIndex = bid.playerIndex;
    this.activeBidIndex = null;
    this.phase = 'resolved';
  }

  // -- Round lifecycle ---------------------------------------------------

  /** Called from `resolved`: locks in the current board as the next round's starting point (matches the real game's evolving board -- a no-op if nobody won, since robots are already back at roundStartRobots) and reveals a new target. */
  startNextRound(nextTarget: Target): void {
    this.roundStartRobots = cloneRobots(this.robots);
    this.moveHistory = [];
    this.selected = null;
    this.target = nextTarget;
    this.phase = 'bidding';
    this.bids = [];
    this.bidDeadline = null;
    this.activeBidIndex = null;
    this.lastRoundWinnerIndex = null;
  }
}

function cloneRobots(robots: RobotPositions): RobotPositions {
  const out = {} as RobotPositions;
  for (const c of ROBOT_COLORS) out[c] = { ...robots[c] };
  return out;
}
