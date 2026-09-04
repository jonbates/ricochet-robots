import { getRelaySockets, joinRoom, selfId } from 'trystero';
import type { ActionMsg, LeaveMatchMsg, LobbyRosterMsg, RenameMsg, StartMatchMsg, StateSnapshot } from './protocol';

// Unique per app -- Trystero namespaces every room under this, so this app's
// rooms never collide with another Trystero app reusing the same room code
// space. Bump only on a breaking wire-format change (old and new clients in
// the same appId would otherwise silently misinterpret each other's packets).
const APP_ID = 'ricochet-robots-v1';

// Trystero signals over public Nostr relays, and defaults to just 5 of the 28
// it ships with -- picked by shuffling that list with a seed derived from
// APP_ID, so *every* player of this app always lands on the same 5. Public
// relays rate-limit and go down often, and a relay socket that fails enough
// times in a row is retired for the lifetime of the page (Trystero doubles a
// per-URL retry period up to a 60s cap, then marks the client closed for
// good, and its relay pool is module-scoped, so even re-joining the room
// hands back the same dead sockets -- only a page reload clears it). Losing
// all 5 therefore means no more peer discovery at all until a refresh, which
// is exactly the "stuck reconnecting" state players kept hitting. Widening
// the pool means more independent relays have to die before that happens,
// and every peer still derives the same set from APP_ID, so they all still
// meet on the same relays.
const RELAY_REDUNDANCY = 12;

/**
 * Mirrors Trystero's MessageAction<T> shape, but without T bound to its JSON
 * DataPayload constraint (which would otherwise force every plain domain
 * interface in protocol.ts to redundantly declare an index signature). We
 * know our message types are all plain JSON-serializable data, so this one
 * cast point (see typedAction below) is where that's asserted, keeping
 * protocol.ts itself unencumbered.
 */
interface TypedAction<T> {
  send: (data: T, options?: { target?: string | string[] | null }) => Promise<void>;
  onMessage: ((data: T, context: { peerId: string; metadata?: unknown }) => void) | null;
}

function typedAction<T>(room: ReturnType<typeof joinRoom>, namespace: string): TypedAction<T> {
  return room.makeAction(namespace) as unknown as TypedAction<T>;
}

/**
 * Thin wrapper around one Trystero room. Host and joiner both construct this
 * same class -- there's no separate "host connection" type at the transport
 * layer; role ('host' | 'client') is a pure application-level distinction
 * layered on top of Trystero's symmetric peer mesh (see main.ts).
 */
export class NetworkRoom {
  private readonly room: ReturnType<typeof joinRoom>;
  readonly selfId = selfId;

  readonly roster;
  readonly startMatch;
  readonly action;
  readonly state;
  readonly rename;
  readonly leaveMatch;

  constructor(roomId: string) {
    this.room = joinRoom({ appId: APP_ID, relayConfig: { redundancy: RELAY_REDUNDANCY } }, roomId);
    this.roster = typedAction<LobbyRosterMsg>(this.room, 'roster');
    this.startMatch = typedAction<StartMatchMsg>(this.room, 'start');
    this.action = typedAction<ActionMsg>(this.room, 'action');
    this.state = typedAction<StateSnapshot>(this.room, 'state');
    this.rename = typedAction<RenameMsg>(this.room, 'rename');
    this.leaveMatch = typedAction<LeaveMatchMsg>(this.room, 'leaveMatch');
  }

  onPeerJoin(cb: (peerId: string) => void): void {
    this.room.onPeerJoin = cb;
  }

  onPeerLeave(cb: (peerId: string) => void): void {
    this.room.onPeerLeave = cb;
  }

  getPeerIds(): string[] {
    return Object.keys(this.room.getPeers());
  }

  /**
   * The relay sockets Trystero is currently signaling over, for
   * net/reconnect.ts's dead-transport check. Exposed from here rather than
   * imported there directly so that `trystero` stays confined to this
   * module -- main.ts only ever `await import`s it (see joinRoomWithCode),
   * which is what keeps the whole library out of the initial bundle for
   * players who never touch online play.
   *
   * Trystero's relay pool is module-scoped and shared by every room, so this
   * reports the page's signaling as a whole, not just this room's slice.
   */
  relaySockets(): Record<string, WebSocket | undefined> {
    return getRelaySockets() as Record<string, WebSocket | undefined>;
  }

  leave(): void {
    void this.room.leave();
  }
}
