import './style.css';
import { Game, type RoundResult, type UpdateInfo, WIN_SCORE } from './Game';
import { robotCssColor } from './colors';

function required<T>(el: T | null, selector: string): T {
  if (!el) throw new Error(`Missing required DOM element: ${selector} -- check index.html`);
  return el;
}

const container = required(document.querySelector<HTMLDivElement>('#app'), '#app');

const scorePlayer = required(document.querySelector<HTMLSpanElement>('#score-player'), '#score-player');
const scoreAi = required(document.querySelector<HTMLSpanElement>('#score-ai'), '#score-ai');
const targetSwatch = required(document.querySelector<HTMLSpanElement>('#target-swatch'), '#target-swatch');
const targetColorName = required(
  document.querySelector<HTMLSpanElement>('#target-color-name'),
  '#target-color-name',
);
const moveCountEl = required(document.querySelector<HTMLParagraphElement>('#hud-move-count'), '#hud-move-count');

const undoBtn = required(document.querySelector<HTMLButtonElement>('#undo-btn'), '#undo-btn');
const resetRoundBtn = required(document.querySelector<HTMLButtonElement>('#reset-round-btn'), '#reset-round-btn');
const submitBtn = required(document.querySelector<HTMLButtonElement>('#submit-btn'), '#submit-btn');

const startOverlay = required(document.querySelector<HTMLDivElement>('#start-overlay'), '#start-overlay');
const startBtn = required(document.querySelector<HTMLButtonElement>('#start-btn'), '#start-btn');
const winScoreEl = required(document.querySelector<HTMLSpanElement>('#win-score'), '#win-score');

const roundOverlay = required(document.querySelector<HTMLDivElement>('#round-overlay'), '#round-overlay');
const roundTitle = required(document.querySelector<HTMLHeadingElement>('#round-title'), '#round-title');
const roundDetail = required(document.querySelector<HTMLParagraphElement>('#round-detail'), '#round-detail');
const roundContinueBtn = required(
  document.querySelector<HTMLButtonElement>('#round-continue-btn'),
  '#round-continue-btn',
);

const matchOverOverlay = required(document.querySelector<HTMLDivElement>('#match-over-overlay'), '#match-over-overlay');
const matchOverTitle = required(document.querySelector<HTMLHeadingElement>('#match-over-title'), '#match-over-title');
const matchOverDetail = required(document.querySelector<HTMLParagraphElement>('#match-over-detail'), '#match-over-detail');
const playAgainBtn = required(document.querySelector<HTMLButtonElement>('#play-again-btn'), '#play-again-btn');

winScoreEl.textContent = String(WIN_SCORE);

let game: Game | null = null;

function showOverlay(overlay: 'start' | 'round' | 'match-over' | 'none'): void {
  startOverlay.classList.toggle('visible', overlay === 'start');
  roundOverlay.classList.toggle('visible', overlay === 'round');
  matchOverOverlay.classList.toggle('visible', overlay === 'match-over');
}

function handleUpdate(info: UpdateInfo): void {
  scorePlayer.textContent = String(info.playerScore);
  scoreAi.textContent = String(info.aiScore);
  targetSwatch.style.background = robotCssColor(info.target.color);
  targetColorName.textContent = info.target.color;
  moveCountEl.textContent = `Moves: ${info.moveCount}`;
  submitBtn.disabled = !info.canSubmit;
}

function handleRoundResult(result: RoundResult): void {
  const outcome =
    result.winner === 'player' ? 'You win the round!' : result.winner === 'ai' ? 'AI wins the round.' : "It's a draw.";
  roundTitle.textContent = outcome;
  const playerLine = `You solved it in ${result.playerMoves} move${result.playerMoves === 1 ? '' : 's'}.`;
  const aiLine =
    result.aiMoves === null
      ? "The AI couldn't find a solution in time."
      : `The AI found a solution in ${result.aiMoves} move${result.aiMoves === 1 ? '' : 's'}.`;
  roundDetail.textContent = `${playerLine} ${aiLine}`;
  showOverlay('round');
}

function handleMatchOver(winner: 'player' | 'ai'): void {
  matchOverTitle.textContent = winner === 'player' ? 'You Won the Match!' : 'AI Wins the Match';
  matchOverDetail.textContent = `First to ${WIN_SCORE} round wins takes it.`;
  showOverlay('match-over');
}

function startGame(): void {
  game?.dispose();
  game = new Game(container, {
    onUpdate: handleUpdate,
    onRoundResult: handleRoundResult,
    onMatchOver: handleMatchOver,
  });
  game.start();
  showOverlay('none');
}

startBtn.addEventListener('click', startGame);
undoBtn.addEventListener('click', () => game?.undo());
resetRoundBtn.addEventListener('click', () => game?.resetRound());
submitBtn.addEventListener('click', () => game?.submit());
roundContinueBtn.addEventListener('click', () => showOverlay('none'));
playAgainBtn.addEventListener('click', () => {
  game?.resetMatch();
  showOverlay('none');
});
