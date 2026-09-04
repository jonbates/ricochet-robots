// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { canAutoReload, signalingIsDead } from './reconnect';

/** Just enough of a WebSocket for signalingIsDead, which only ever reads readyState. */
const socket = (readyState: number): WebSocket => ({ readyState }) as WebSocket;

const OPEN = 1;
const CLOSING = 2;
const CLOSED = 3;
const CONNECTING = 0;

describe('signalingIsDead', () => {
  // The distinction that matters: this predicate gates a page reload, so
  // anything short of "every relay is genuinely finished" has to read as
  // alive, or players get reloaded out of a game that was about to recover.
  it('is false before any room has been joined', () => {
    expect(signalingIsDead({})).toBe(false);
  });

  it('is false while any relay is open', () => {
    expect(signalingIsDead({ a: socket(CLOSED), b: socket(OPEN), c: socket(CLOSED) })).toBe(false);
  });

  it('is false while any relay is still retrying', () => {
    expect(signalingIsDead({ a: socket(CLOSED), b: socket(CONNECTING) })).toBe(false);
  });

  it('is true only once every relay is closed', () => {
    expect(signalingIsDead({ a: socket(CLOSED), b: socket(CLOSED), c: socket(CLOSING) })).toBe(true);
  });

  it('treats a relay with no socket at all as dead rather than alive', () => {
    expect(signalingIsDead({ a: undefined, b: socket(CLOSED) })).toBe(true);
  });
});

describe('canAutoReload', () => {
  const NOW = 1_000_000;

  beforeEach(() => {
    sessionStorage.clear();
  });

  it('allows the first auto-reload', () => {
    expect(canAutoReload(NOW)).toBe(true);
  });

  // The whole point of the cooldown: if we reloaded and are right back here,
  // reloading again just loops. Hand off to the manual button instead.
  it('refuses a second reload while the last one is still fresh', () => {
    sessionStorage.setItem('rr-auto-reconnect-at', String(NOW - 5_000));
    expect(canAutoReload(NOW)).toBe(false);
  });

  it('allows a later, unrelated outage to auto-recover again', () => {
    sessionStorage.setItem('rr-auto-reconnect-at', String(NOW - 10 * 60_000));
    expect(canAutoReload(NOW)).toBe(true);
  });

  it('ignores a corrupt marker rather than refusing to ever recover', () => {
    sessionStorage.setItem('rr-auto-reconnect-at', 'not-a-number');
    expect(canAutoReload(NOW)).toBe(true);
  });
});
