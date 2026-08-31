import { type Board, cellKey, type Cell, type Direction, ROBOT_COLORS, type RobotColor, sameCell } from '../board/Board';
import type { Target } from '../board/BoardLayout';

export interface Move {
  color: RobotColor;
  from: Cell;
  to: Cell;
}

export type RobotPositions = Record<RobotColor, Cell>;

/** Robot positions, move history (for undo/reset), the active target, and match score -- all pure state, no rendering. */
export class GameState {
  robots: RobotPositions;
  roundStartRobots: RobotPositions;
  moveHistory: Move[] = [];
  selected: RobotColor | null = null;
  target: Target;
  playerScore = 0;
  aiScore = 0;
  private readonly board: Board;

  constructor(board: Board, initialRobots: RobotPositions, initialTarget: Target) {
    this.board = board;
    this.robots = cloneRobots(initialRobots);
    this.roundStartRobots = cloneRobots(initialRobots);
    this.target = initialTarget;
  }

  select(color: RobotColor): void {
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

  /** Slides the selected robot. Returns false (no-op) if nothing is selected or the robot can't move that way. */
  move(direction: Direction): boolean {
    if (!this.selected) return false;
    const color = this.selected;
    const from = this.robots[color];
    const to = this.board.slideDestination(from, direction, this.occupiedExcept(color));
    if (sameCell(from, to)) return false;
    this.robots[color] = to;
    this.moveHistory.push({ color, from, to });
    return true;
  }

  undo(): boolean {
    const last = this.moveHistory.pop();
    if (!last) return false;
    this.robots[last.color] = last.from;
    return true;
  }

  resetRound(): void {
    this.robots = cloneRobots(this.roundStartRobots);
    this.moveHistory = [];
    this.selected = null;
  }

  get moveCount(): number {
    return this.moveHistory.length;
  }

  isSolved(): boolean {
    return sameCell(this.robots[this.target.color], this.target.cell);
  }

  /** Called on round submit: locks in the current board as the next round's starting point (robots stay where the player left them, matching the real game's evolving board) and reveals a new target. */
  startNextRound(nextTarget: Target): void {
    this.roundStartRobots = cloneRobots(this.robots);
    this.moveHistory = [];
    this.selected = null;
    this.target = nextTarget;
  }
}

function cloneRobots(robots: RobotPositions): RobotPositions {
  const out = {} as RobotPositions;
  for (const c of ROBOT_COLORS) out[c] = { ...robots[c] };
  return out;
}
