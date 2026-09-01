// Wire-format types shared by host and client. Pure data -- no Trystero or
// DOM imports here, so both sides of the network code can import this
// without pulling in anything else.

import type { Direction, RobotColor } from '../board/Board';
import type { BoardVariantId, QuadrantAssignment, Target } from '../board/BoardLayout';
import type { Bid, Move, Player, RobotPositions, RoundPhase } from '../game/GameState';

export type PeerId = string; // Trystero's own connection id -- ephemeral, regenerated on every reconnect/refresh
export type PlayerId = string; // this app's own stable per-tab identity (see main.ts's myPlayerId), persisted across a refresh so a rejoining peer can be recognized despite getting a brand-new PeerId

export interface LobbyPlayer {
  peerId: PeerId;
  playerId: PlayerId;
  name: string;
  isHost: boolean;
}

/** Host -> everyone, whenever the roster or board-variant choice changes. */
export interface LobbyRosterMsg {
  players: LobbyPlayer[];
  variantId: BoardVariantId;
}

/**
 * Host -> everyone, once, when the host clicks "Start Match" -- and again,
 * targeted at just one peer, whenever that peer (re)joins mid-match (see
 * Game.handleRename) so a refreshed/reconnected peer can rebuild the exact
 * same match from scratch. Carries every value the three unseeded
 * Math.random() call sites in BoardLayout.ts/Game.ts would otherwise have
 * produced independently on each peer (quadrant assignment, initial robot
 * positions, first target) -- the host resolves them once and every peer
 * (including itself) builds the identical Board/GameState from these values
 * instead of calling the randomized defaults. `playerOrder[i]` is the
 * PlayerId (stable across a refresh, unlike PeerId) controlling `players[i]`;
 * the host's own myPlayerId is included like any other player. `matchId` is
 * a fresh id per match, letting a peer that already has this exact match
 * live (a same-tab reconnect blip, not a real refresh) skip rebuilding its
 * Game/WebGL renderer when this message arrives again -- see main.ts's
 * `currentMatchId` check.
 */
export interface StartMatchMsg {
  variantId: BoardVariantId;
  quadrantAssignment: QuadrantAssignment;
  searchDepth: number;
  playerOrder: PlayerId[];
  playerNames: string[];
  initialRobots: RobotPositions;
  firstTarget: Target;
  matchId: string;
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
  | { type: 'playAgain' }
  | { type: 'revealSolution' };

/**
 * Client -> host, sent once right after joining -- both a fresh join (the
 * display name typed into "Your name", before the host had a chance to
 * assign a placeholder) and a rejoin (a refresh or reconnect mid-match,
 * where `name` is whatever was persisted alongside `playerId`). `playerId`
 * is what actually lets the host recognize a rejoin: see Game.handleRename,
 * which resends StartMatchMsg + a fresh StateSnapshot, targeted, the moment
 * it sees a `playerId` matching an existing match slot.
 */
export interface RenameMsg {
  name: string;
  playerId: PlayerId;
}

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
 *
 * `revealed` mirrors whether any peer has clicked "Reveal Optimal Solution"
 * this round -- solve() itself is never sent over the wire (it's a pure
 * function of already-synced state, so every peer just runs it locally and
 * gets an identical answer), but *whether* it's been revealed needs to be
 * shared so every peer's board shows the same overlay, and clears its own
 * stale attempt trail, at the same moment.
 *
 * `connectedSlots[i]` is whether `players[i]`'s peer currently has a live
 * connection to the host -- host-computed from its own live peerId<->
 * PlayerId map (see Game.handleRename/handlePeerLeave), purely so every
 * peer's UI can show a "reconnecting..." cue next to a dropped player
 * instead of leaving their row looking identical to someone mid-turn.
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
  revealed: boolean;
  connectedSlots: boolean[];
}
