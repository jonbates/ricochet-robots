import { joinRoom, selfId } from 'trystero';
import type { ActionMsg, LobbyRosterMsg, StartMatchMsg, StateSnapshot } from './protocol';

// Unique per app -- Trystero namespaces every room under this, so this app's
// rooms never collide with another Trystero app reusing the same room code
// space. Bump only on a breaking wire-format change (old and new clients in
// the same appId would otherwise silently misinterpret each other's packets).
const APP_ID = 'ricochet-robots-v1';

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

  constructor(roomId: string) {
    this.room = joinRoom({ appId: APP_ID }, roomId);
    this.roster = typedAction<LobbyRosterMsg>(this.room, 'roster');
    this.startMatch = typedAction<StartMatchMsg>(this.room, 'start');
    this.action = typedAction<ActionMsg>(this.room, 'action');
    this.state = typedAction<StateSnapshot>(this.room, 'state');
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

  leave(): void {
    void this.room.leave();
  }
}
