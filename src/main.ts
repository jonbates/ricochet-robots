import './style.css';
import { DEFAULT_SEARCH_DEPTH, Game, LOCAL_NETWORK_CONTEXT, type NetworkContext, pickTarget, type UpdateInfo, WIN_SCORE } from './Game';
import { buildBoardVariant, type BoardVariantId, randomInitialRobots, randomQuadrantAssignment, type Target } from './board/BoardLayout';
import { BID_WINDOW_MS, type Bid, type Player } from './game/GameState';
import type { Cell, Direction } from './board/Board';
import { buildTargetIconCanvas } from './render/targetIcon2d';
import type { NetworkRoom } from './net/room';
import { generateRoomCode, normalizeCodeInput, toRoomId } from './net/roomCode';
import type { LobbyPlayer, StartMatchMsg, StateSnapshot } from './net/protocol';

function required<T>(el: T | null, selector: string): T {
  if (!el) throw new Error(`Missing required DOM element: ${selector} -- check index.html`);
  return el;
}

const container = required(document.querySelector<HTMLDivElement>('#board-area'), '#board-area');

const reconnectingBanner = required(
  document.querySelector<HTMLDivElement>('#reconnecting-banner'),
  '#reconnecting-banner',
);

const hudTimer = required(document.querySelector<HTMLDivElement>('#hud-timer'), '#hud-timer');
const hudTimerText = required(document.querySelector<HTMLSpanElement>('#hud-timer-text'), '#hud-timer-text');
const endCountdownBtn = required(
  document.querySelector<HTMLButtonElement>('#end-countdown-btn'),
  '#end-countdown-btn',
);
const hudAttemptStatus = required(
  document.querySelector<HTMLDivElement>('#hud-attempt-status'),
  '#hud-attempt-status',
);
const hudAttemptBid = required(document.querySelector<HTMLSpanElement>('#hud-attempt-bid'), '#hud-attempt-bid');

const hudLeftTop = required(document.querySelector<HTMLDivElement>('#hud-left-top'), '#hud-left-top');
const hudPlayers = required(document.querySelector<HTMLDivElement>('#hud-players'), '#hud-players');
const hudTarget = required(document.querySelector<HTMLDivElement>('#hud-target'), '#hud-target');
const targetSpotlightSlot = required(
  document.querySelector<HTMLDivElement>('#hud-target-spotlight-slot'),
  '#hud-target-spotlight-slot',
);
const targetSwatch = required(document.querySelector<HTMLSpanElement>('#target-swatch'), '#target-swatch');
const targetColorName = required(
  document.querySelector<HTMLSpanElement>('#target-color-name'),
  '#target-color-name',
);

const hudGiveUp = required(document.querySelector<HTMLDivElement>('#hud-give-up'), '#hud-give-up');
const giveUpBtn = required(document.querySelector<HTMLButtonElement>('#give-up-btn'), '#give-up-btn');

const mobileDpad = required(document.querySelector<HTMLDivElement>('#mobile-dpad'), '#mobile-dpad');
const dpadButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.dpad-btn'));

const hudAttempting = required(document.querySelector<HTMLDivElement>('#hud-attempting'), '#hud-attempting');
const attemptBanner = required(document.querySelector<HTMLParagraphElement>('#attempt-banner'), '#attempt-banner');
const attemptMovesRemaining = required(
  document.querySelector<HTMLParagraphElement>('#attempt-moves-remaining'),
  '#attempt-moves-remaining',
);
const ricochetHint = required(document.querySelector<HTMLParagraphElement>('#ricochet-hint'), '#ricochet-hint');
const undoBtn = required(document.querySelector<HTMLButtonElement>('#undo-btn'), '#undo-btn');
const concedeBtn = required(document.querySelector<HTMLButtonElement>('#concede-btn'), '#concede-btn');

const startOverlay = required(document.querySelector<HTMLDivElement>('#start-overlay'), '#start-overlay');
const boardButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.board-btn'));
const winScoreEl = required(document.querySelector<HTMLSpanElement>('#win-score'), '#win-score');
const playerCountSelect = required(
  document.querySelector<HTMLSelectElement>('#player-count-select'),
  '#player-count-select',
);
const playerNameInputs = Array.from(document.querySelectorAll<HTMLInputElement>('.player-name-input'));
const searchDepthInput = required(
  document.querySelector<HTMLInputElement>('#search-depth-input'),
  '#search-depth-input',
);

// All round-resolved messaging (the outcome, the revealed solution, and
// Continue) lives in this left-sidebar panel -- there's no separate floating
// dialog over the board anymore, so nothing needs to stay reachable behind
// one.
const roundResultPanel = required(document.querySelector<HTMLDivElement>('#hud-round-result'), '#hud-round-result');
const roundResultDetail = required(
  document.querySelector<HTMLParagraphElement>('#round-result-detail'),
  '#round-result-detail',
);
const solutionDetail = required(document.querySelector<HTMLDivElement>('#solution-detail'), '#solution-detail');
const revealSolutionBtn = required(
  document.querySelector<HTMLButtonElement>('#reveal-solution-btn'),
  '#reveal-solution-btn',
);
const roundContinueBtn = required(
  document.querySelector<HTMLButtonElement>('#round-continue-btn'),
  '#round-continue-btn',
);

const matchOverOverlay = required(document.querySelector<HTMLDivElement>('#match-over-overlay'), '#match-over-overlay');
const matchOverTitle = required(document.querySelector<HTMLHeadingElement>('#match-over-title'), '#match-over-title');
const playAgainBtn = required(document.querySelector<HTMLButtonElement>('#play-again-btn'), '#play-again-btn');

const playOnlineBtn = required(document.querySelector<HTMLButtonElement>('#play-online-btn'), '#play-online-btn');
const lobbyOverlay = required(document.querySelector<HTMLDivElement>('#lobby-overlay'), '#lobby-overlay');
const lobbyModeSelect = required(document.querySelector<HTMLDivElement>('#lobby-mode-select'), '#lobby-mode-select');
const lobbyNameInput = required(document.querySelector<HTMLInputElement>('#lobby-name-input'), '#lobby-name-input');
const lobbyHostBtn = required(document.querySelector<HTMLButtonElement>('#lobby-host-btn'), '#lobby-host-btn');
const lobbyJoinCodeInput = required(
  document.querySelector<HTMLInputElement>('#lobby-join-code-input'),
  '#lobby-join-code-input',
);
const lobbyJoinBtn = required(document.querySelector<HTMLButtonElement>('#lobby-join-btn'), '#lobby-join-btn');
const lobbyError = required(document.querySelector<HTMLParagraphElement>('#lobby-error'), '#lobby-error');
const lobbyModeBackBtn = required(
  document.querySelector<HTMLButtonElement>('#lobby-mode-back-btn'),
  '#lobby-mode-back-btn',
);

const lobbyRoom = required(document.querySelector<HTMLDivElement>('#lobby-room'), '#lobby-room');
const lobbyRoomCodeValue = required(
  document.querySelector<HTMLElement>('#lobby-room-code-value'),
  '#lobby-room-code-value',
);
const lobbyBoardSelect = required(document.querySelector<HTMLDivElement>('#lobby-board-select'), '#lobby-board-select');
const lobbyBoardButtons = Array.from(document.querySelectorAll<HTMLButtonElement>('.lobby-board-btn'));
const lobbyBoardReadonly = required(
  document.querySelector<HTMLParagraphElement>('#lobby-board-readonly'),
  '#lobby-board-readonly',
);
const lobbyRosterList = required(document.querySelector<HTMLDivElement>('#lobby-roster-list'), '#lobby-roster-list');
const lobbyStartBtn = required(document.querySelector<HTMLButtonElement>('#lobby-start-btn'), '#lobby-start-btn');
const lobbyWaitingText = required(
  document.querySelector<HTMLParagraphElement>('#lobby-waiting-text'),
  '#lobby-waiting-text',
);
const lobbyLeaveBtn = required(document.querySelector<HTMLButtonElement>('#lobby-leave-btn'), '#lobby-leave-btn');

const attemptInstructions = required(
  document.querySelector<HTMLParagraphElement>('#attempt-instructions'),
  '#attempt-instructions',
);

winScoreEl.textContent = String(WIN_SCORE);
searchDepthInput.value = String(DEFAULT_SEARCH_DEPTH);

let game: Game | null = null;
let currentPlayerNames: string[] = [];
let lastPhase: UpdateInfo['phase'] | null = null;
let lastInfo: UpdateInfo | null = null;
// Hot-seat default target for the digit-key quick-bid capture below when no
// row's input has been focused yet this round -- online play doesn't need
// this, since mySlot always resolves unambiguously to the local player's own row.
let lastFocusedBidRow = 0;

// -- Online lobby (Trystero, host-authoritative -- see src/net/) -----------

// A stable identity for *this browser tab*, independent of Trystero's own
// peerId (regenerated on every reconnect/refresh) -- this is what lets a
// rejoining peer be recognized as the same player rather than a stranger
// (see Game.handleRename). Deliberately sessionStorage-scoped: survives a
// refresh (the main reason this exists), but not a fresh tab/window or a
// browser restart, since this isn't meant to be a persistent account.
const MY_PLAYER_ID_KEY = 'rr-my-player-id';
const myPlayerId =
  sessionStorage.getItem(MY_PLAYER_ID_KEY) ??
  (() => {
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(MY_PLAYER_ID_KEY, fresh);
    return fresh;
  })();

// One persisted record for whatever room this tab is currently in, if any --
// enough to silently restore into it on the next page load (a refresh, or
// reopening a tab within the same browser session). Versioned like
// net/room.ts's own APP_ID, so a stale record from a prior deploy with an
// incompatible shape is just never read rather than crashing the restore.
const SESSION_KEY = 'rr-session-v1';
interface PersistedHostSession {
  role: 'host';
  roomCode: string;
  startMsg: StartMatchMsg;
  snapshot: StateSnapshot;
}
interface PersistedClientSession {
  role: 'client';
  roomCode: string;
  name: string;
}
type PersistedSession = PersistedHostSession | PersistedClientSession;

function readPersistedSession(): PersistedSession | null {
  const raw = sessionStorage.getItem(SESSION_KEY);
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'role' in parsed &&
      (parsed.role === 'host' || parsed.role === 'client') &&
      'roomCode' in parsed &&
      typeof parsed.roomCode === 'string'
    ) {
      return parsed as PersistedSession;
    }
  } catch {
    // Malformed/incompatible record -- treat exactly like "nothing persisted".
  }
  return null;
}

function clearPersistedSession(): void {
  sessionStorage.removeItem(SESSION_KEY);
}

let room: NetworkRoom | null = null;
let myRole: 'host' | 'client' | null = null;
let lobbyVariantId: BoardVariantId = 'classic';
let lobbyPlayers: LobbyPlayer[] = [];
let currentRoomCode: string | null = null;
// Lets a rejoining client's startMatch.onMessage tell "I already have this
// exact match live" (a same-tab reconnect blip) apart from a genuine
// refresh, so a blip doesn't visibly tear down and rebuild the WebGL
// renderer -- the state broadcast that immediately follows resyncs the
// still-live Game on its own.
let currentMatchId: string | null = null;

function generateSelfName(): string {
  return `Player ${Math.floor(1000 + Math.random() * 9000)}`;
}
lobbyNameInput.value = generateSelfName();

function showLobbySubView(view: 'mode-select' | 'room'): void {
  lobbyModeSelect.classList.toggle('visible', view === 'mode-select');
  lobbyRoom.classList.toggle('visible', view === 'room');
}

function leaveRoom(): void {
  room?.leave();
  room = null;
  myRole = null;
  lobbyPlayers = [];
  currentRoomCode = null;
  currentMatchId = null;
  clearPersistedSession();
}

/**
 * Host-only: bound (with `startMsg` already captured -- see call sites) as
 * Game's onSnapshot callback, fired at the end of every broadcastState() --
 * persists enough to fully restore this exact match (see
 * restoreHostSession) on this tab's next load. `startMsg` is passed in
 * directly, captured at the call site, rather than read back off `game` --
 * the constructor's own *first* broadcastState() call fires synchronously
 * from inside `new Game(...)`, before main.ts's own `game` variable has
 * been assigned the constructor's return value, so relying on that
 * module-level variable here would silently drop exactly that first
 * snapshot (leaving nothing to restore if the host refreshes in the brief
 * window before the next real mutation or heartbeat).
 */
function persistHostSession(startMsg: StartMatchMsg, snapshot: StateSnapshot): void {
  if (!currentRoomCode) return;
  const record: PersistedHostSession = { role: 'host', roomCode: currentRoomCode, startMsg, snapshot };
  sessionStorage.setItem(SESSION_KEY, JSON.stringify(record));
}

function broadcastRoster(): void {
  room?.roster.send({ players: lobbyPlayers, variantId: lobbyVariantId });
}

function renderRoster(): void {
  lobbyRosterList.replaceChildren();
  for (const player of lobbyPlayers) {
    const row = document.createElement('div');
    row.className = 'lobby-roster-row';

    const name = document.createElement('span');
    name.className = 'lobby-roster-name';
    name.textContent = player.name;
    row.appendChild(name);

    if (player.isHost) {
      const hostTag = document.createElement('span');
      hostTag.className = 'lobby-roster-host-tag';
      hostTag.textContent = 'HOST';
      row.appendChild(hostTag);
    }
    lobbyRosterList.appendChild(row);
  }
  // Only meaningful for the host (lobbyStartBtn stays hidden for a joining
  // client, see joinRoomWithCode) -- don't allow starting a "networked"
  // match with no one else actually connected yet.
  lobbyStartBtn.disabled = lobbyPlayers.length < 2;
  lobbyStartBtn.title = lobbyStartBtn.disabled ? 'Waiting for at least one other player to join...' : '';
}

function boardLabel(variantId: BoardVariantId): string {
  return variantId === 'diagonal' ? 'Diagonal Board' : 'Classic Board';
}

function renderLobbyBoardReadonly(): void {
  lobbyBoardReadonly.textContent = `Board: ${boardLabel(lobbyVariantId)}`;
}

function renderLobbyBoardSelected(): void {
  for (const btn of lobbyBoardButtons) {
    btn.classList.toggle('selected', btn.dataset.variant === lobbyVariantId);
  }
}

/**
 * Wires the host's three room-lifetime peer-lifecycle listeners --
 * NetworkRoom's onPeerJoin/onPeerLeave/rename.onMessage are single-slot
 * callback properties, not multi-listener emitters, so exactly one place in
 * the app can own them; main.ts does, for the room's *entire* lifetime
 * (lobby and match alike), forwarding into game?.handleRename/
 * handlePeerLeave once a match is live. Shared by hostRoom() (a fresh room)
 * and restoreHostSession() (a host restoring an in-progress match after its
 * own refresh) so both wire up identically.
 */
function wireHostPeerHandlers(newRoom: NetworkRoom): void {
  newRoom.onPeerJoin((peerId) => {
    // A placeholder -- the joining peer sends its own chosen name (see
    // joinRoomWithCode) as soon as its connection to us is ready, via the
    // `rename` handler below. Guarded against a peer that's already present
    // because the two events race: this "someone connected" notification
    // and the guest's own rename message can arrive in either order.
    if (!lobbyPlayers.some((p) => p.peerId === peerId)) {
      lobbyPlayers.push({ peerId, playerId: peerId, name: `Guest ${lobbyPlayers.length + 1}`, isHost: false });
    }
    broadcastRoster();
    renderRoster();
  });
  newRoom.onPeerLeave((peerId) => {
    lobbyPlayers = lobbyPlayers.filter((p) => p.peerId !== peerId);
    broadcastRoster();
    renderRoster();
    game?.handlePeerLeave(peerId);
  });
  newRoom.rename.onMessage = (msg, ctx) => {
    const name = msg.name.trim();
    if (name) {
      const existing = lobbyPlayers.find((p) => p.peerId === ctx.peerId);
      if (existing) {
        existing.name = name;
        existing.playerId = msg.playerId;
      } else {
        lobbyPlayers.push({ peerId: ctx.peerId, playerId: msg.playerId, name, isHost: false });
      }
      broadcastRoster();
      renderRoster();
    }
    // Forwarded unconditionally (even for an empty/whitespace name, and
    // regardless of whether a match is even live yet -- a no-op via `game?.`
    // in that case) -- this is also how the host recognizes a *rejoin*, see
    // Game.handleRename's own doc comment.
    game?.handleRename(ctx.peerId, msg.playerId);
  };
}

async function hostRoom(): Promise<void> {
  leaveRoom();
  const code = generateRoomCode();
  const { NetworkRoom } = await import('./net/room');
  const newRoom = new NetworkRoom(toRoomId(code));
  room = newRoom;
  myRole = 'host';
  currentRoomCode = code;
  lobbyVariantId = 'classic';
  lobbyPlayers = [
    { peerId: newRoom.selfId, playerId: myPlayerId, name: lobbyNameInput.value.trim() || generateSelfName(), isHost: true },
  ];
  wireHostPeerHandlers(newRoom);

  lobbyRoomCodeValue.textContent = code;
  lobbyBoardSelect.hidden = false;
  lobbyBoardReadonly.hidden = true;
  lobbyStartBtn.hidden = false;
  lobbyWaitingText.hidden = true;
  renderRoster();
  renderLobbyBoardSelected();
  broadcastRoster();
  lobbyOverlay.classList.add('visible');
  showLobbySubView('room');
}

async function joinRoomWithCode(rawCode: string): Promise<void> {
  const code = normalizeCodeInput(rawCode);
  if (code.length !== 5) {
    lobbyError.textContent = 'Enter the 5-character room code.';
    return;
  }
  lobbyError.textContent = '';
  leaveRoom();
  const { NetworkRoom } = await import('./net/room');
  const newRoom = new NetworkRoom(toRoomId(code));
  room = newRoom;
  myRole = 'client';
  currentRoomCode = code;

  newRoom.roster.onMessage = (msg) => {
    lobbyPlayers = msg.players;
    lobbyVariantId = msg.variantId;
    lobbyWaitingText.hidden = false;
    renderRoster();
    renderLobbyBoardReadonly();
  };
  newRoom.startMatch.onMessage = (msg) => {
    // Already have this exact match live -- a same-tab reconnect blip, not a
    // real refresh (which would have wiped `game`/`currentMatchId` too).
    // Skip the rebuild; the state broadcast that immediately follows this
    // (see Game.handleRename) resyncs the still-live Game on its own, with
    // no visible dispose/reconstruct flash.
    if (msg.matchId === currentMatchId && game) return;
    beginMultiplayerMatch(msg);
  };
  newRoom.onPeerLeave((peerId) => {
    game?.handlePeerLeave(peerId);
  });
  // Send our own chosen name (and stable identity) the moment the host's
  // connection is actually ready (rather than right away, before any peer
  // connection exists yet, which Trystero would just silently drop) -- the
  // host has only one peer to wait for here, so this fires exactly once per
  // connection. Also persists this tab's session so a refresh can restore
  // it, and (via `playerId`) is what lets the host recognize this as a
  // *rejoin* if it happens to be one -- see Game.handleRename.
  newRoom.onPeerJoin(() => {
    const name = lobbyNameInput.value.trim() || generateSelfName();
    const record: PersistedClientSession = { role: 'client', roomCode: code, name };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(record));
    void newRoom.rename.send({ name, playerId: myPlayerId });
  });

  lobbyRoomCodeValue.textContent = code;
  lobbyBoardSelect.hidden = true;
  lobbyBoardReadonly.hidden = false;
  lobbyBoardReadonly.textContent = 'Connecting...';
  lobbyStartBtn.hidden = true;
  lobbyWaitingText.hidden = true; // shown once the host's roster actually arrives, not before
  lobbyRosterList.replaceChildren();
  lobbyOverlay.classList.add('visible');
  showLobbySubView('room');
}

/** Host-only: resolves the three Math.random() call sites BoardLayout/Game would otherwise call independently on every peer (quadrant assignment, initial robot positions, first target), sends the result to everyone, and begins the match locally. */
function startMultiplayerMatch(): void {
  if (!room || myRole !== 'host') return;
  if (lobbyPlayers.length < 2) return; // the Start button is disabled for this same reason -- this is defense in depth, not the primary gate
  const quadrantAssignment = randomQuadrantAssignment();
  const variant = buildBoardVariant(lobbyVariantId, quadrantAssignment);
  const firstTarget = pickTarget(variant.targets, null);
  const initialRobots = randomInitialRobots([firstTarget.cell]);
  const msg: StartMatchMsg = {
    variantId: lobbyVariantId,
    quadrantAssignment,
    searchDepth: currentSearchDepth(),
    playerOrder: lobbyPlayers.map((p) => p.playerId),
    playerNames: lobbyPlayers.map((p) => p.name),
    initialRobots,
    firstTarget,
    matchId: crypto.randomUUID(),
  };
  const initialPeerMap = new Map(lobbyPlayers.map((p) => [p.peerId, p.playerId]));
  room.startMatch.send(msg);
  beginMultiplayerMatch(msg, initialPeerMap);
}

function beginMultiplayerMatch(msg: StartMatchMsg, initialPeerMap?: ReadonlyMap<string, string>): void {
  if (!room || !myRole) return;
  const mySlot = msg.playerOrder.indexOf(myPlayerId);
  const net: NetworkContext = {
    role: myRole,
    room,
    playerOrder: msg.playerOrder,
    mySlot: mySlot === -1 ? null : mySlot,
    myPlayerId,
    matchId: msg.matchId,
  };

  currentPlayerNames = msg.playerNames;
  currentMatchId = msg.matchId;
  lobbyOverlay.classList.remove('visible');
  startOverlay.classList.remove('visible');
  game?.dispose();
  lastPhase = null;
  game = new Game(
    container,
    msg.variantId,
    msg.playerNames,
    {
      onUpdate: handleUpdate,
      onMatchOver: handleMatchOver,
      onSnapshot: myRole === 'host' ? (snapshot) => persistHostSession(msg, snapshot) : undefined,
    },
    msg.searchDepth,
    net,
    { quadrantAssignment: msg.quadrantAssignment, initialRobots: msg.initialRobots, firstTarget: msg.firstTarget },
    myRole === 'host' ? initialPeerMap : undefined,
  );
  game.start();
}

/**
 * Host-only: reconstructs an in-progress match from a persisted session (see
 * persistHostSession) on this tab's next load after a refresh -- rejoins the
 * same room, re-wires the same peer-lifecycle handlers a fresh hostRoom()
 * would, and constructs Game directly from the persisted StartMatchMsg +
 * StateSnapshot instead of starting a fresh round. lobbyPlayers is seeded
 * with just the host's own entry (not a placeholder per remote player) --
 * guests aren't reachable yet, and the lobby overlay is skipped entirely
 * here anyway, so there's nothing for a placeholder entry to usefully
 * display; each guest's own row repopulates itself the moment they
 * reconnect and re-send their rename handshake, exactly as in a fresh lobby.
 */
async function restoreHostSession(record: PersistedHostSession): Promise<void> {
  try {
    const { NetworkRoom } = await import('./net/room');
    const newRoom = new NetworkRoom(toRoomId(record.roomCode));
    room = newRoom;
    myRole = 'host';
    currentRoomCode = record.roomCode;
    currentMatchId = record.startMsg.matchId;
    lobbyVariantId = record.startMsg.variantId;
    const myIndex = record.startMsg.playerOrder.indexOf(myPlayerId);
    lobbyPlayers = [
      {
        peerId: newRoom.selfId,
        playerId: myPlayerId,
        name: record.startMsg.playerNames[myIndex] ?? generateSelfName(),
        isHost: true,
      },
    ];
    wireHostPeerHandlers(newRoom);

    const net: NetworkContext = {
      role: 'host',
      room: newRoom,
      playerOrder: record.startMsg.playerOrder,
      mySlot: myIndex === -1 ? null : myIndex,
      myPlayerId,
      matchId: record.startMsg.matchId,
    };
    currentPlayerNames = record.startMsg.playerNames;
    startOverlay.classList.remove('visible');
    lastPhase = null;
    game = new Game(
      container,
      record.startMsg.variantId,
      record.startMsg.playerNames,
      {
        onUpdate: handleUpdate,
        onMatchOver: handleMatchOver,
        onSnapshot: (snapshot) => persistHostSession(record.startMsg, snapshot),
      },
      record.startMsg.searchDepth,
      net,
      {
        quadrantAssignment: record.startMsg.quadrantAssignment,
        initialRobots: record.startMsg.initialRobots,
        firstTarget: record.startMsg.firstTarget,
      },
      new Map([[newRoom.selfId, myPlayerId]]),
      record.snapshot,
    );
    game.start();
  } catch (err) {
    console.error('Failed to restore host session', err);
    clearPersistedSession();
    startOverlay.classList.add('visible');
  }
}

function backToStartOverlay(): void {
  leaveRoom();
  lobbyOverlay.classList.remove('visible');
  startOverlay.classList.add('visible');
}

function updatePlayerNameInputVisibility(): void {
  const count = Number(playerCountSelect.value);
  playerNameInputs.forEach((input, i) => {
    input.hidden = i >= count;
  });
}
playerCountSelect.addEventListener('change', updatePlayerNameInputVisibility);
updatePlayerNameInputVisibility();

function currentPlayerSetup(): string[] {
  const count = Number(playerCountSelect.value);
  return playerNameInputs.slice(0, count).map((input) => input.value.trim() || input.defaultValue);
}

// UpdateInfo.players is the same array reference every frame within a match
// (Game only mutates player scores in place; a new match assigns a new
// array) -- so rebuilding these rows is only ever needed once per match, not
// once per frame. Rebuilding on every frame (as an earlier version did) tears
// down and recreates each element, including the bid button's click
// listener, ~60 times a second -- a click's mousedown and mouseup can then
// land on two different button instances, and the browser just drops the
// click when that happens.
let playersBuiltFor: readonly Player[] | null = null;
let playerRowEls: {
  row: HTMLDivElement;
  scoreEl: HTMLSpanElement;
  bidValue: HTMLSpanElement;
  bidInput: HTMLInputElement;
  bidBtn: HTMLButtonElement;
  reconnectingTag: HTMLSpanElement;
}[] = [];

function buildPlayerRows(players: readonly Player[]): void {
  hudPlayers.replaceChildren();
  playerRowEls = players.map((player, i) => {
    const row = document.createElement('div');
    row.className = 'player-row';

    // Grouped together (rather than appended as a third sibling of `right`
    // below) so the row's own justify-between still only ever balances two
    // items -- name+tag on the left, bid controls/score on the right --
    // regardless of whether the tag is currently shown.
    const nameGroup = document.createElement('div');
    nameGroup.className = 'player-name-group';

    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = player.name;

    // Shown only while this row's peer has no live connection to the host
    // (see connectedSlots/handlePeerLeave) -- hidden the rest of the time,
    // including for local hot-seat play, where connectedSlots is always [].
    const reconnectingTag = document.createElement('span');
    reconnectingTag.className = 'player-reconnecting-tag';
    reconnectingTag.textContent = 'reconnecting…';
    reconnectingTag.hidden = true;

    nameGroup.append(name, reconnectingTag);

    const right = document.createElement('div');
    right.className = 'player-row-right';

    const bidValue = document.createElement('span');
    bidValue.className = 'player-bid-value';

    // The bid count control lives right next to its own player/Bid button
    // (not a single shared input above the list) -- with several players
    // bidding in turn, a shared field made it easy to bid with a number left
    // over from whoever typed into it last.
    const bidInput = document.createElement('input');
    bidInput.type = 'number';
    bidInput.min = '1';
    bidInput.step = '1';
    bidInput.value = '3';
    bidInput.className = 'player-bid-input';
    // Focusing (via click, keyboard, or the digit-key quick-bid capture
    // below) clears the field instead of leaving the previous/default
    // number selected -- so typing a fresh count never requires a manual
    // select-all/backspace first.
    bidInput.addEventListener('focus', () => {
      bidInput.value = '';
      lastFocusedBidRow = i;
    });

    const bidBtn = document.createElement('button');
    bidBtn.type = 'button';
    bidBtn.className = 'secondary-btn small-btn player-bid-btn';
    bidBtn.textContent = 'Bid';
    const placeBid = () => {
      const moves = Math.max(1, Math.floor(Number(bidInput.value) || 1));
      game?.placeBid(i, moves);
    };
    bidBtn.addEventListener('click', placeBid);
    bidInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') placeBid();
    });

    const scoreEl = document.createElement('span');
    scoreEl.className = 'player-score';

    right.append(bidValue, bidInput, bidBtn, scoreEl);
    row.append(nameGroup, right);
    hudPlayers.appendChild(row);
    return { row, scoreEl, bidValue, bidInput, bidBtn, reconnectingTag };
  });
}

function renderPlayers(info: UpdateInfo): void {
  if (info.players !== playersBuiltFor) {
    buildPlayerRows(info.players);
    playersBuiltFor = info.players;
  }
  info.players.forEach((player, i) => {
    const els = playerRowEls[i];
    els.scoreEl.textContent = String(player.score);
    els.row.classList.toggle('active-bidder', info.activeBidPlayerIndex === i);
    // connectedSlots[i] is only ever explicitly `false` for a known-disconnected
    // networked player -- `undefined` (local play, connectedSlots is always [])
    // and `true` both mean "don't show this".
    els.reconnectingTag.hidden = info.connectedSlots[i] !== false;
    const bid = info.bids.find((b: Bid) => b.playerIndex === i);
    els.bidValue.textContent = bid ? `bid ${bid.moves}` : '';
    // In a networked match, only my own row's bid controls are usable -- I can't bid on another connected player's behalf. Local hot-seat play (mySlot === null) keeps every row's controls, since it's one shared keyboard.
    const showBidControls = info.phase === 'bidding' && (info.mySlot === null || info.mySlot === i);
    els.bidInput.hidden = !showBidControls;
    els.bidBtn.hidden = !showBidControls;
  });
}

function targetLabel(target: Target): string {
  if (target.color === 'warp') return 'Warp (any robot)';
  return `${target.color} ${target.shape}`;
}

/**
 * Reparents the single #hud-target element between a top-center "spotlight"
 * slot (a brief "here's today's target" reveal, shown before anyone has bid
 * this round) and its normal spot at the top of the left sidebar (once
 * bidding is actually underway) -- same element throughout, so its content
 * only needs to be filled in once here rather than duplicated in two places.
 */
let targetIconBuiltFor: Target | null = null;

function renderTarget(info: UpdateInfo): void {
  // Same reference-equality trick as the player rows below -- info.target
  // only actually changes once a round, so there's no need to redraw the
  // canvas icon on every frame. Guarded by its own try/catch -- this icon
  // is cosmetic, and every round swaps in a fresh target, so one bad
  // draw shouldn't be able to wedge itself into permanently failing here
  // (skipping past renderTimer/renderAttempting below it) every frame for
  // the rest of the match.
  if (info.target !== targetIconBuiltFor) {
    try {
      targetSwatch.replaceChildren(buildTargetIconCanvas(info.target, 40));
    } catch (err) {
      console.error('Failed to draw target icon', err);
    }
    targetIconBuiltFor = info.target;
  }
  targetColorName.textContent = targetLabel(info.target);

  const spotlight = info.phase === 'bidding' && info.bids.length === 0;
  hudTarget.classList.toggle('hud-target-spotlight', spotlight);
  if (spotlight) {
    if (hudTarget.parentElement !== targetSpotlightSlot) targetSpotlightSlot.appendChild(hudTarget);
  } else if (hudTarget.parentElement !== hudLeftTop) {
    hudLeftTop.prepend(hudTarget);
  }
}

/** Linearly interpolates the timer's border from green (full time left) to red (about to expire), so the countdown reads as urgent without anyone having to watch the number itself. */
function timerBorderColor(progress: number): string {
  const clamped = Math.min(1, Math.max(0, progress));
  const from = { r: 34, g: 197, b: 94 }; // Tailwind green-500
  const to = { r: 239, g: 68, b: 68 }; // Tailwind red-500
  const r = Math.round(from.r + (to.r - from.r) * clamped);
  const g = Math.round(from.g + (to.g - from.g) * clamped);
  const b = Math.round(from.b + (to.b - from.b) * clamped);
  return `rgb(${r} ${g} ${b})`;
}

function renderTimer(info: UpdateInfo): void {
  const show = info.phase === 'bidding' && info.bidCountdownMs !== null;
  hudTimer.hidden = !show;
  if (show && info.bidCountdownMs !== null) {
    const totalSeconds = Math.ceil(info.bidCountdownMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    hudTimerText.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
    hudTimer.style.borderColor = timerBorderColor(1 - info.bidCountdownMs / BID_WINDOW_MS);
  }
}

// See handleUpdate's own `myTurn` doc comment -- everyone but the peer
// occupying the active bidder's slot has arrow keys/clicks that are inert
// (Game.canActNow), so this says so and visibly disables Undo/Concede rather
// than leaving them clickable but silently no-op. Local hot-seat play
// (mySlot === null) keeps the original "click a robot..." instructions,
// since anyone at the shared keyboard can act whenever it's the turn.
function renderAttempting(info: UpdateInfo, myTurn: boolean): void {
  attemptBanner.textContent = `${info.activePlayerName} is attempting`;
  attemptMovesRemaining.textContent = `Moves remaining: ${info.remainingMoves}`;
  ricochetHint.hidden = !info.blockedByRicochetRule;
  hudAttemptBid.textContent = `Bid ${info.activeBidMoves} · ${info.remainingMoves} left`;
  attemptInstructions.textContent = myTurn
    ? 'Click a robot to select it · Arrow keys to slide it · Z to undo'
    : `Waiting for ${info.activePlayerName} to move...`;
  undoBtn.disabled = !myTurn;
  concedeBtn.disabled = !myTurn;
}

function describeMove(move: { color: string; from: Cell; to: Cell }): string {
  const dir = move.to.col > move.from.col ? 'east' : move.to.col < move.from.col ? 'west' : move.to.row > move.from.row ? 'south' : 'north';
  return `${move.color} → ${dir}`;
}

function renderResolved(info: UpdateInfo): void {
  roundResultDetail.textContent = info.roundWinnerName
    ? `${info.roundWinnerName} wins the round!`
    : 'Nobody solved it in time.';
}

function handleUpdate(info: UpdateInfo): void {
  // In a networked match, only the peer occupying the active bidder's slot
  // can actually move (see Game.canActNow) -- showing the D-pad to everyone
  // else invited taps that would just silently no-op. Local hot-seat play
  // (mySlot === null) keeps it visible for whoever's turn it is, since
  // anyone at the shared keyboard/touchscreen can act.
  const myTurn = info.mySlot === null || info.mySlot === info.activeBidPlayerIndex;

  // Phase-gated visibility first, before anything that renders actual
  // content (player rows, the target icon, the timer) -- those are
  // cosmetic and shouldn't be able to leave critical move-control UI (the
  // D-pad, the attempting panel) stuck in a stale hidden/shown state just
  // because something later in this function throws.
  hudAttempting.hidden = info.phase !== 'attempting';
  mobileDpad.hidden = info.phase !== 'attempting' || !myTurn;
  hudAttemptStatus.hidden = info.phase !== 'attempting';
  hudGiveUp.hidden = info.phase === 'resolved';
  roundResultPanel.hidden = info.phase !== 'resolved';
  reconnectingBanner.hidden = info.hostConnected;

  renderPlayers(info);
  renderTarget(info);
  renderTimer(info);
  if (info.phase === 'attempting') renderAttempting(info, myTurn);

  if (info.phase === 'resolved' && lastPhase !== 'resolved') {
    // Populate once on entry, not every frame, and reset the reveal state
    // left over from whatever the previous round did with it.
    renderResolved(info);
    solutionDetail.hidden = true;
    solutionDetail.textContent = '';
    revealSolutionBtn.disabled = false;
    revealSolutionBtn.textContent = 'Reveal Optimal Solution';
  }
  lastPhase = info.phase;
  lastInfo = info;
}

function handleMatchOver(winner: Player): void {
  matchOverTitle.textContent = `${winner.name} Wins the Match!`;
  matchOverOverlay.classList.add('visible');
}

function currentSearchDepth(): number {
  const parsed = Math.floor(Number(searchDepthInput.value));
  return parsed >= 1 ? parsed : DEFAULT_SEARCH_DEPTH;
}

function startGame(variantId: BoardVariantId): void {
  leaveRoom(); // solo/hot-seat play always starts from a clean slate, even if reached via "Back" out of an online lobby
  currentPlayerNames = currentPlayerSetup();
  game?.dispose();
  lastPhase = null;
  game = new Game(
    container,
    variantId,
    currentPlayerNames,
    { onUpdate: handleUpdate, onMatchOver: handleMatchOver },
    currentSearchDepth(),
    LOCAL_NETWORK_CONTEXT,
  );
  game.start();
  startOverlay.classList.remove('visible');
}

for (const btn of boardButtons) {
  btn.addEventListener('click', () => {
    const variantId = btn.dataset.variant as BoardVariantId;
    startGame(variantId);
  });
}
endCountdownBtn.addEventListener('click', () => game?.endCountdownEarly());
giveUpBtn.addEventListener('click', () => game?.giveUpRound());
undoBtn.addEventListener('click', () => game?.undo());
concedeBtn.addEventListener('click', () => game?.concede());
for (const btn of dpadButtons) {
  const direction = btn.dataset.direction as Direction;
  btn.addEventListener('click', (e) => {
    // The D-pad is a translucent overlay -- a robot can visibly sit right
    // underneath it. If this tap landed on one, select it (as a direct
    // board tap would) instead of always treating a tap here as a move in
    // this button's direction.
    const clickedThroughToRobot = game?.selectRobotAtPoint(e.clientX, e.clientY) ?? false;
    if (!clickedThroughToRobot) game?.move(direction);
    e.stopPropagation();
  });
}

// Lets a player start bidding by just pressing a number key, without first
// clicking into their row's bid input -- while bidding is active and no bid
// input already has focus (typing into one normally is left alone), a
// digit key focuses the relevant row's input (mySlot online, otherwise
// whichever row was last focused, defaulting to the first) and types it in,
// same as if the player had clicked the field and typed themselves.
window.addEventListener('keydown', (e) => {
  if (!lastInfo || lastInfo.phase !== 'bidding') return;
  if (!/^[0-9]$/.test(e.key)) return;
  if (document.activeElement instanceof HTMLInputElement && document.activeElement.classList.contains('player-bid-input')) return;
  const row = playerRowEls[lastInfo.mySlot ?? lastFocusedBidRow];
  if (!row || row.bidInput.hidden) return;
  // Without this, focusing the input mid-handler (below) doesn't stop the
  // browser's own default action for this same keystroke -- it still goes
  // on to insert the digit into the now-focused field on top of the value
  // set here, doubling it (a lone "7" becomes "77").
  e.preventDefault();
  row.bidInput.focus(); // clears the field first, see its own 'focus' handler above
  row.bidInput.value = e.key;
});
roundContinueBtn.addEventListener('click', () => game?.continueToNextRound());
revealSolutionBtn.addEventListener('click', () => {
  const result = game?.revealSolution();
  // Disabled in place rather than hidden -- hiding it would collapse its
  // spot in the panel and shift Continue up into it, right under wherever
  // the player's finger/cursor still was, risking an accidental tap on
  // Continue immediately after Reveal.
  revealSolutionBtn.disabled = true;
  revealSolutionBtn.textContent = 'Solution Revealed';
  if (!result) {
    solutionDetail.textContent = 'No solution found within a reasonable search depth.';
  } else if (result.count === 0) {
    solutionDetail.textContent = 'Already solved -- 0 moves needed.';
  } else {
    // The dotted arrow path is drawn directly on the board by revealSolution() itself.
    solutionDetail.textContent = `Optimal: ${result.count} move${result.count === 1 ? '' : 's'} -- ${result.moves.map(describeMove).join(', ')}`;
  }
  solutionDetail.hidden = false;
});
playAgainBtn.addEventListener('click', () => {
  game?.resetMatch(currentPlayerNames);
  matchOverOverlay.classList.remove('visible');
});

// -- Online lobby wiring -----------------------------------------------

playOnlineBtn.addEventListener('click', () => {
  lobbyError.textContent = '';
  lobbyJoinCodeInput.value = '';
  startOverlay.classList.remove('visible');
  lobbyOverlay.classList.add('visible');
  showLobbySubView('mode-select');
});
lobbyModeBackBtn.addEventListener('click', backToStartOverlay);
lobbyLeaveBtn.addEventListener('click', backToStartOverlay);
lobbyHostBtn.addEventListener('click', hostRoom);
lobbyJoinBtn.addEventListener('click', () => joinRoomWithCode(lobbyJoinCodeInput.value));
lobbyJoinCodeInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') joinRoomWithCode(lobbyJoinCodeInput.value);
});
lobbyStartBtn.addEventListener('click', startMultiplayerMatch);
for (const btn of lobbyBoardButtons) {
  btn.addEventListener('click', () => {
    if (myRole !== 'host') return;
    lobbyVariantId = btn.dataset.variant as BoardVariantId;
    renderLobbyBoardSelected();
    broadcastRoster();
  });
}

// Opening a shared link (?room=CODE) drops straight into the join flow --
// takes priority over a silently-restored session below, since it's an
// explicit action just taken (e.g. clicking a fresh invite link in a new
// tab that happens to share this browser's session storage).
const urlRoomCode = new URLSearchParams(window.location.search).get('room');
if (urlRoomCode) {
  lobbyJoinCodeInput.value = urlRoomCode;
  startOverlay.classList.remove('visible');
  lobbyOverlay.classList.add('visible');
  joinRoomWithCode(urlRoomCode);
} else {
  // Otherwise, silently restore whatever room/match this tab was in before
  // its last refresh, if any (see leaveRoom()/persistHostSession() for where
  // this gets written and cleared).
  const restored = readPersistedSession();
  if (restored?.role === 'host') {
    startOverlay.classList.remove('visible');
    restoreHostSession(restored);
  } else if (restored?.role === 'client') {
    lobbyNameInput.value = restored.name;
    startOverlay.classList.remove('visible');
    lobbyOverlay.classList.add('visible');
    joinRoomWithCode(restored.roomCode);
  }
}
