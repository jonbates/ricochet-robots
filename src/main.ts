import './style.css';
import { DEFAULT_SEARCH_DEPTH, Game, type UpdateInfo, WIN_SCORE } from './Game';
import type { BoardVariantId, Target } from './board/BoardLayout';
import type { Bid, Player } from './game/GameState';
import type { Cell } from './board/Board';
import { targetCssColor } from './colors';

function required<T>(el: T | null, selector: string): T {
  if (!el) throw new Error(`Missing required DOM element: ${selector} -- check index.html`);
  return el;
}

const container = required(document.querySelector<HTMLDivElement>('#board-area'), '#board-area');

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

const hudBidInput = required(document.querySelector<HTMLDivElement>('#hud-bid-input'), '#hud-bid-input');
const bidAmountInput = required(document.querySelector<HTMLInputElement>('#bid-amount'), '#bid-amount');

const hudGiveUp = required(document.querySelector<HTMLDivElement>('#hud-give-up'), '#hud-give-up');
const giveUpBtn = required(document.querySelector<HTMLButtonElement>('#give-up-btn'), '#give-up-btn');

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

winScoreEl.textContent = String(WIN_SCORE);
searchDepthInput.value = String(DEFAULT_SEARCH_DEPTH);

let game: Game | null = null;
let currentPlayerNames: string[] = [];
let lastPhase: UpdateInfo['phase'] | null = null;

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
let playerRowEls: { row: HTMLDivElement; scoreEl: HTMLSpanElement; bidValue: HTMLSpanElement; bidBtn: HTMLButtonElement }[] =
  [];

function buildPlayerRows(players: readonly Player[]): void {
  hudPlayers.replaceChildren();
  playerRowEls = players.map((player, i) => {
    const row = document.createElement('div');
    row.className = 'player-row';

    const name = document.createElement('span');
    name.className = 'player-name';
    name.textContent = player.name;

    const right = document.createElement('div');
    right.className = 'player-row-right';

    const bidValue = document.createElement('span');
    bidValue.className = 'player-bid-value';

    const bidBtn = document.createElement('button');
    bidBtn.type = 'button';
    bidBtn.className = 'secondary-btn small-btn player-bid-btn';
    bidBtn.textContent = 'Bid';
    bidBtn.addEventListener('click', () => {
      const moves = Math.max(1, Math.floor(Number(bidAmountInput.value) || 1));
      game?.placeBid(i, moves);
    });

    const scoreEl = document.createElement('span');
    scoreEl.className = 'player-score';

    right.append(bidValue, bidBtn, scoreEl);
    row.append(name, right);
    hudPlayers.appendChild(row);
    return { row, scoreEl, bidValue, bidBtn };
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
    els.row.classList.toggle('active-bidder', info.activePlayerName === player.name);
    const bid = info.bids.find((b: Bid) => b.playerIndex === i);
    els.bidValue.textContent = bid ? `bid ${bid.moves}` : '';
    els.bidBtn.hidden = info.phase !== 'bidding';
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
function renderTarget(info: UpdateInfo): void {
  targetSwatch.style.background = targetCssColor(info.target.color);
  targetColorName.textContent = targetLabel(info.target);

  const spotlight = info.phase === 'bidding' && info.bids.length === 0;
  hudTarget.classList.toggle('hud-target-spotlight', spotlight);
  if (spotlight) {
    if (hudTarget.parentElement !== targetSpotlightSlot) targetSpotlightSlot.appendChild(hudTarget);
  } else if (hudTarget.parentElement !== hudLeftTop) {
    hudLeftTop.prepend(hudTarget);
  }
}

function renderTimer(info: UpdateInfo): void {
  const show = info.phase === 'bidding' && info.bidCountdownMs !== null;
  hudTimer.hidden = !show;
  if (show && info.bidCountdownMs !== null) {
    const totalSeconds = Math.ceil(info.bidCountdownMs / 1000);
    const minutes = Math.floor(totalSeconds / 60);
    const seconds = totalSeconds % 60;
    hudTimerText.textContent = `${minutes}:${String(seconds).padStart(2, '0')}`;
  }
}

function renderAttempting(info: UpdateInfo): void {
  attemptBanner.textContent = `${info.activePlayerName} is attempting`;
  attemptMovesRemaining.textContent = `Moves remaining: ${info.remainingMoves}`;
  ricochetHint.hidden = !info.blockedByRicochetRule;
  hudAttemptBid.textContent = `Bid ${info.activeBidMoves} · ${info.remainingMoves} left`;
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
  renderPlayers(info);
  renderTarget(info);
  renderTimer(info);

  hudBidInput.hidden = info.phase !== 'bidding';
  hudAttempting.hidden = info.phase !== 'attempting';
  hudAttemptStatus.hidden = info.phase !== 'attempting';
  hudGiveUp.hidden = info.phase === 'resolved';
  roundResultPanel.hidden = info.phase !== 'resolved';
  if (info.phase === 'attempting') renderAttempting(info);

  if (info.phase === 'resolved' && lastPhase !== 'resolved') {
    // Populate once on entry, not every frame, and reset the reveal state
    // left over from whatever the previous round did with it.
    renderResolved(info);
    solutionDetail.hidden = true;
    solutionDetail.textContent = '';
    revealSolutionBtn.hidden = false;
  }
  lastPhase = info.phase;
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
  currentPlayerNames = currentPlayerSetup();
  game?.dispose();
  lastPhase = null;
  game = new Game(
    container,
    variantId,
    currentPlayerNames,
    { onUpdate: handleUpdate, onMatchOver: handleMatchOver },
    currentSearchDepth(),
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
roundContinueBtn.addEventListener('click', () => game?.continueToNextRound());
revealSolutionBtn.addEventListener('click', () => {
  const result = game?.revealSolution();
  revealSolutionBtn.hidden = true;
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
