/**
 * Recovery for the one network failure this app can't heal in place.
 *
 * Trystero signals over public Nostr relays. When a relay socket closes it
 * retries on a doubling backoff, and once that period passes a 60s cap it
 * marks the relay client closed *permanently* -- and its relay pool is
 * module-scoped and keyed by URL, so even tearing down the room and
 * re-joining hands back the same dead sockets. Nothing short of a page load
 * rebuilds them. That's the "stuck on reconnecting..." state: the app is
 * waiting on an onPeerJoin that can never fire again, because there is no
 * longer any signaling path to discover a peer over.
 *
 * So: once we've been disconnected for a while *and* every relay socket is
 * dead, reload -- sessionStorage already carries enough to drop straight
 * back into the room/match (see readPersistedSession in main.ts), so this is
 * the refresh players were doing by hand. If a reload doesn't fix it we stop
 * trying and hand the decision back to the player rather than sitting in a
 * reload loop against, say, a downed home connection.
 */

/** How long both "we think we're disconnected" and "signaling is dead" have to hold before it's worth reloading over -- long enough that an ordinary blip, which Trystero does recover from on its own, never trips it. */
const DEAD_GRACE_MS = 15_000;
const CHECK_INTERVAL_MS = 2_000;
/** An auto-reload inside this window of the last one means the reload didn't help -- stop and show the player a button instead of looping. */
const RELOAD_COOLDOWN_MS = 90_000;
const RELOAD_MARKER_KEY = 'rr-auto-reconnect-at';

/** Shape of NetworkRoom.relaySockets() -- passed in rather than read from `trystero` here, so this module stays free of that import and out of the online-only chunk's way. */
export type SocketMap = Record<string, WebSocket | undefined>;

const isAlive = (socket: WebSocket | undefined): boolean =>
  !!socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING);

/**
 * True once every relay Trystero opened is closed and not retrying -- i.e.
 * this page has no signaling left at all. An empty map means no room has
 * been joined yet, which is not a failure.
 */
export function signalingIsDead(sockets: SocketMap): boolean {
  const all = Object.values(sockets);
  return all.length > 0 && !all.some(isAlive);
}

function lastAutoReloadAt(): number | null {
  try {
    const raw = sessionStorage.getItem(RELOAD_MARKER_KEY);
    if (!raw) return null;
    const at = Number(raw);
    return Number.isFinite(at) ? at : null;
  } catch {
    return null; // private browsing, blocked storage -- treated as "never reloaded"
  }
}

/** Exported for the watcher's own use and for tests -- a reload is only worth attempting if the last one isn't still fresh enough to have plainly not worked. */
export function canAutoReload(now: number = Date.now()): boolean {
  const last = lastAutoReloadAt();
  return last === null || now - last > RELOAD_COOLDOWN_MS;
}

function markAutoReload(now: number): void {
  try {
    sessionStorage.setItem(RELOAD_MARKER_KEY, String(now));
  } catch {
    // Not fatal -- without the marker the cooldown just can't be enforced,
    // and the onGiveUp fallback below still bounds this to one reload.
  }
}

export interface ConnectionWatchOptions {
  /** Whether the app currently believes it's cut off from the peer(s) it needs. Kept out here because only main.ts knows what "disconnected" means for the current role and screen. */
  isDisconnected: () => boolean;
  /** The live relay sockets, or `{}` before any room has been joined -- see NetworkRoom.relaySockets. */
  getSockets: () => SocketMap;
  /** Called instead of reloading when a reload has already been tried and didn't take -- surface a manual control at this point. */
  onGiveUp: () => void;
}

/** Starts the watcher. Returns a stop function; safe to call more than once. */
export function watchConnection({ isDisconnected, getSockets, onGiveUp }: ConnectionWatchOptions): () => void {
  let deadSince: number | null = null;
  let gaveUp = false;

  const tick = (): void => {
    if (gaveUp) return;
    if (!isDisconnected()) {
      // Connected -- reset the clock, and let a later, unrelated outage get
      // an auto-reload of its own rather than inheriting this one's cooldown.
      deadSince = null;
      clearReloadMarker();
      return;
    }
    if (!signalingIsDead(getSockets())) {
      deadSince = null; // a plain drop -- Trystero still has relays, and recovers these on its own
      return;
    }
    const now = Date.now();
    deadSince ??= now;
    if (now - deadSince < DEAD_GRACE_MS) return;
    if (canAutoReload(now)) {
      markAutoReload(now);
      window.location.reload();
      return;
    }
    gaveUp = true;
    onGiveUp();
  };

  const timer = window.setInterval(tick, CHECK_INTERVAL_MS);
  return () => window.clearInterval(timer);
}

function clearReloadMarker(): void {
  try {
    sessionStorage.removeItem(RELOAD_MARKER_KEY);
  } catch {
    // See markAutoReload -- storage being unavailable is never fatal here.
  }
}
