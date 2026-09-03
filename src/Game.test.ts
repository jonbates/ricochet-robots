// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

// Game.ts constructs a real WebGLRenderer, which needs an actual GPU/WebGL
// context that jsdom can't provide -- everything else BoardRenderer touches
// (Scene, Mesh, geometries, materials...) is plain data and works fine
// un-mocked. Replacing just WebGLRenderer keeps this test exercising Game's
// real orchestration logic (GameState, applySnapshot, revealSolution) rather
// than a reimplementation of it.
vi.mock('three', async (importOriginal) => {
  const actual = await importOriginal<typeof import('three')>();
  class FakeWebGLRenderer {
    domElement = document.createElement('canvas');
    shadowMap = { enabled: false, type: 0 };
    setPixelRatio(): void {}
    setSize(): void {}
    render(): void {}
    dispose(): void {}
  }
  return { ...actual, WebGLRenderer: FakeWebGLRenderer };
});

import { buildBoardVariant, randomQuadrantAssignment, VAULT_CELLS } from './board/BoardLayout';
import { cellKey, ROBOT_COLORS, type RobotColor } from './board/Board';
import type { GameState } from './game/GameState';
import type { ActionMsg, StateSnapshot } from './net/protocol';
import type { NetworkRoom } from './net/room';
import { Game, type GameCallbacks, type MatchStart, type NetworkContext, pickTarget } from './Game';

// jsdom doesn't implement ResizeObserver, and its canvas 2d context is null
// without the native `canvas` package -- Game/BoardRenderer only ever touch
// a handful of methods on either, so a minimal stub is enough to let real
// construction/rendering logic run without either dependency.
beforeAll(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      unobserve(): void {}
      disconnect(): void {}
    },
  );
  const fake2dContext = {
    beginPath() {},
    arc() {},
    fill() {},
    stroke() {},
    fillText() {},
  } as unknown as CanvasRenderingContext2D;
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation((id: string) =>
    id === '2d' ? fake2dContext : null,
  );
});

/** Two ends of an in-memory duplex channel -- `a.send` reaches `b.onMessage` (tagged with `aPeerId`, i.e. how `b` sees `a`) and vice versa, mirroring TypedAction's shape from net/room.ts closely enough for Game.ts's needs. */
function makeChannelPair<T>(
  aPeerId: string,
  bPeerId: string,
): [
  { onMessage: ((data: T, ctx: { peerId: string }) => void) | null; send: (data: T) => Promise<void> },
  { onMessage: ((data: T, ctx: { peerId: string }) => void) | null; send: (data: T) => Promise<void> },
] {
  const a: { onMessage: ((data: T, ctx: { peerId: string }) => void) | null; send: (data: T) => Promise<void> } = {
    onMessage: null,
    send: async (data) => {
      b.onMessage?.(data, { peerId: aPeerId });
    },
  };
  const b: typeof a = {
    onMessage: null,
    send: async (data) => {
      a.onMessage?.(data, { peerId: bPeerId });
    },
  };
  return [a, b];
}

const HOST_PEER_ID = 'host-peer';
const CLIENT_PEER_ID = 'client-peer';

/** A pair of fake NetworkRoom-shaped objects wired so the host's state broadcasts reach the client, and the client's action sends reach the host -- enough for Game.ts's own use of `net.room`, without any real Trystero/WebRTC connection. Tags each direction with a stable peerId (see HOST_PEER_ID/CLIENT_PEER_ID) so the host's real handleIncomingAction sender-recognition logic (peerIdToPlayerId) has something to resolve, same as it would from a real Trystero message. */
function createHostClientRooms(): { hostRoom: NetworkRoom; clientRoom: NetworkRoom } {
  const [hostState, clientState] = makeChannelPair<StateSnapshot>(HOST_PEER_ID, CLIENT_PEER_ID);
  const [clientAction, hostAction] = makeChannelPair<ActionMsg>(CLIENT_PEER_ID, HOST_PEER_ID);
  const inertChannel = () => ({ onMessage: null, send: async () => {} });
  const hostRoom = { state: hostState, action: hostAction, startMatch: inertChannel() } as unknown as NetworkRoom;
  const clientRoom = { state: clientState, action: clientAction, startMatch: inertChannel() } as unknown as NetworkRoom;
  return { hostRoom, clientRoom };
}

function makeCallbacks(): GameCallbacks {
  return { onUpdate: () => {}, onMatchOver: () => {} };
}

/** Selects whichever robot can actually move, in some direction, and moves it -- enough to get a non-empty moveHistory without depending on a specific board layout. */
function makeSomeMove(state: GameState): void {
  for (const color of ROBOT_COLORS) {
    state.select(color);
    for (const dir of ['N', 'E', 'S', 'W'] as const) {
      if (state.move(dir)) return;
    }
  }
  throw new Error('no robot could move -- test board setup is degenerate');
}

const games: Game[] = [];
function track(game: Game): Game {
  games.push(game);
  return game;
}

afterEach(() => {
  for (const game of games.splice(0)) game.dispose();
});

describe('Game networked reveal-solution sync', () => {
  it("clears a client's stale attempt trail once the solution is revealed, even after the host's confirming snapshot round-trips back", async () => {
    const { hostRoom, clientRoom } = createHostClientRooms();
    const quadrantAssignment = randomQuadrantAssignment();
    const variant = buildBoardVariant('classic', quadrantAssignment);
    const vaultKeys = new Set(VAULT_CELLS.map((c) => cellKey(c.col, c.row)));
    const initialRobots = { red: { col: 1, row: 1 }, blue: { col: 14, row: 1 }, green: { col: 1, row: 14 }, yellow: { col: 14, row: 14 } };
    for (const color of Object.keys(initialRobots) as RobotColor[]) {
      expect(vaultKeys.has(cellKey(initialRobots[color].col, initialRobots[color].row))).toBe(false);
    }
    const firstTarget = pickTarget(variant.targets, null);
    const matchStart: MatchStart = { quadrantAssignment, initialRobots, firstTarget };

    const hostNet: NetworkContext = { role: 'host', room: hostRoom, playerOrder: ['p1', 'p2'], mySlot: 0, myPlayerId: 'p1', matchId: 'm1' };
    const clientNet: NetworkContext = { role: 'client', room: clientRoom, playerOrder: ['p1', 'p2'], mySlot: 1, myPlayerId: 'p2', matchId: 'm1' };

    const hostContainer = document.body.appendChild(document.createElement('div'));
    const clientContainer = document.body.appendChild(document.createElement('div'));

    // Maps the fake client peer's connection id to its stable PlayerId --
    // handleIncomingAction drops any action from a peerId it can't resolve
    // this way, same as it would for a real, never-renamed Trystero peer.
    const initialPeerMap = new Map([[CLIENT_PEER_ID, 'p2']]);

    // searchDepth kept tiny -- this test doesn't care whether the solver
    // actually finds a solution (revealSolution() sets `revealed` either
    // way), only that a shallow search stays fast regardless.
    const hostGame = track(new Game(hostContainer, 'classic', ['Host', 'Client'], makeCallbacks(), 2, hostNet, matchStart, initialPeerMap));
    const clientGame = track(new Game(clientContainer, 'classic', ['Host', 'Client'], makeCallbacks(), 2, clientNet, matchStart));

    // Drive the host straight into an in-progress attempt with a real move
    // on the books, bypassing the real bidding countdown (no render loop is
    // running in this test, so GameState.tick() never fires on its own).
    const hostState = (hostGame as unknown as { state: GameState }).state;
    hostState.placeBid(0, 5, performance.now());
    hostState.endCountdownEarly(performance.now());
    hostState.tick(performance.now());
    expect(hostState.phase).toBe('attempting');
    makeSomeMove(hostState);
    expect(hostState.moveHistory.length).toBeGreaterThan(0);
    // A normal (non-reveal) broadcast, same as every real move triggers --
    // syncs the in-progress trail onto the client, matching "a networked
    // player has started a path" before they ever touch Reveal.
    (hostGame as unknown as { broadcastState: () => void }).broadcastState();

    const clientBoardRenderer = (clientGame as unknown as { boardRenderer: { moveTrailGroup: unknown } }).boardRenderer;
    expect(clientBoardRenderer.moveTrailGroup).not.toBeNull();

    // Client reveals -- it's a client, so this both draws its own solution
    // locally and round-trips an action to the host, which broadcasts a
    // fresh snapshot back (still carrying the host's non-empty
    // moveHistory, since revealing doesn't itself end the round).
    await clientGame.revealSolution();

    expect(clientBoardRenderer.moveTrailGroup).toBeNull();
  });
});
