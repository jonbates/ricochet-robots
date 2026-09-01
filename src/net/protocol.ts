// Wire-format types shared by host and client. Pure data -- no Trystero or
// DOM imports here, so both sides of the network code can import this
// without pulling in anything else.

import type { Direction, RobotColor } from '../board/Board';
import type { BoardVariantId, QuadrantAssignment, Target } from '../board/BoardLayout';
import type { Bid, Move, Player, RobotPositions, RoundPhase } from '../game/GameState';

export type PeerId = string;

export interface LobbyPlayer {
  peerId: PeerId;
  name: string;
  isHost: boolean;
}

/** Host -> everyone, whenever the roster or board-variant choice changes. */
export interface LobbyRosterMsg {
  players: LobbyPlayer[];
  variantId: BoardVariantId;
}

/**
 * Host -> everyone, once, when the host clicks "Start Match". Carries every
 * value the three unseeded Math.random() call sites in BoardLayout.ts/
 * Game.ts would otherwise have produced independently on each peer
 * (quadrant assignment, initial robot positions, first target) -- the host
 * resolves them once and every peer (including itself) builds the identical
 * Board/GameState from these values instead of calling the randomized
 * defaults. `playerOrder[i]` is the peer controlling `players[i]`; the
 * host's own selfId is included like any other peer.
 */
export interface StartMatchMsg {
  variantId: BoardVariantId;
  quadrantAssignment: QuadrantAssignment;
  searchDepth: number;
  playerOrder: PeerId[];
  playerNames: string[];
  initialRobots: RobotPositions;
  firstTarget: Target;
}

/**
 * Client -> host: "I'd like to do X," scoped to the sender's own slot. The
 * host resolves the sender's playerIndex from the peerId Trystero attaches
 * to the message (via StartMatchMsg.playerOrder) -- the message itself never
 * carries a claimed playerIndex, so a client can't act on another player's
 * behalf. Mirrors GameState's own mutator signatures 1:1 (minus the
 * playerIndex/now arguments, which the host supplies itself).
 */
export type ActionMsg =
  | { type: 'placeBid'; moves: number }
  | { type: 'select'; color: RobotColor }
  | { type: 'deselect' }
  | { type: 'move'; direction: Direction }
  | { type: 'undo' }
  | { type: 'concede' }
  | { type: 'endCountdownEarly' }
  | { type: 'giveUpRound' }
  | { type: 'continueToNextRound' }
  | { type: 'playAgain' };

/**
 * Host -> everyone: the host's authoritative GameState, sent in full
 * immediately after any successful mutation, plus on a low-rate heartbeat
 * while a bid countdown is running (purely so it keeps ticking down on
 * other peers' screens between real state changes). Not diffed/delta-encoded
 * -- the whole thing (4 robot cells, a handful of players/bids, a short move
 * history, one target) stays well under a kilobyte even in a long attempt,
 * so there's no bandwidth reason to complicate this.
 *
 * `bidCountdownMs` is the host's own already-computed "ms remaining" value
 * (Game.ts computes this locally every frame purely for its own UI) --
 * deliberately not the raw `bidDeadline` timestamp, since performance.now()
 * origins aren't comparable across machines. A receiving client applies
 * every other field directly onto its own (otherwise-inert) GameState
 * instance and reads `bidCountdownMs` straight through to its UI.
 */
export interface StateSnapshot {
  robots: RobotPositions;
  roundStartRobots: RobotPositions;
  moveHistory: Move[];
  selected: RobotColor | null;
  target: Target;
  players: Player[];
  phase: RoundPhase;
  bids: Bid[];
  activeBidIndex: number | null;
  lastRoundWinnerIndex: number | null;
  bidCountdownMs: number | null;
}
