import type { BoardState, DiceState, GameState, Movie } from '@movie-game/shared';
import { CardChip } from '../components/CardChip';
import { getMovieById } from '../data/movies';

interface ResultsProps {
  state: GameState | BoardState | DiceState;
  onRematch: () => void;
  onExit: () => void;
}

function declaredCards(state: GameState | BoardState | DiceState, playerId: string): number {
  return state.declared
    .filter((combo) => combo.playerId === playerId)
    .reduce((total, combo) => total + combo.cards.length, 0);
}

function movieFor(comboMovieId: string | undefined): Movie | undefined {
  return getMovieById(comboMovieId);
}

export function Results({ state, onRematch, onExit }: ResultsProps) {
  const standings = [...state.players].sort(
    (a, b) =>
      b.score - a.score ||
      declaredCards(state, b.id) - declaredCards(state, a.id) ||
      state.players.indexOf(a) - state.players.indexOf(b),
  );
  const isDraw = 'draw' in state && state.draw === true;
  const winner = isDraw
    ? null
    : state.players.find((player) => player.id === state.winnerId) ?? standings[0];
  const winningCombo = winner
    ? state.declared
        .filter((combo) => combo.playerId === winner.id)
        .sort((a, b) =>
          state.mode === 'create' ? b.turn - a.turn : b.points - a.points,
        )[0]
    : undefined;
  const winningMovie = movieFor(winningCombo?.movieId);
  // At the round limit the engine increments `round` past `maxRounds` to end the
  // game, so clamp to show the number of rounds actually played.
  const roundsPlayed = Math.min(state.round, state.maxRounds);

  return (
    <div className="results" role="dialog" aria-modal="true" aria-labelledby="results-title">
      <div className="results__panel">
        <p className="results__eyebrow">Game over</p>
        <h2 id="results-title">{isDraw ? "It's a draw!" : `${winner?.name} wins!`}</h2>
        <p className="muted results__subtitle">
          {isDraw
            ? 'Nobody reached the target — and the top scores are tied.'
            : state.mode === 'find'
              ? 'The best movie detective at the table.'
              : 'The strongest pitch of the night.'}
        </p>

        {winningCombo && (
          <div className="results__highlight">
            <span className="results__highlight-label">
              {state.mode === 'create' ? 'Winning pitch' : 'Best combo'}
            </span>
            {state.mode === 'create' ? (
              <>
                <strong>{winningCombo.claimedTitle || 'Untitled pitch'}</strong>
                {winningCombo.claimedSynopsis && (
                  <p className="results__synopsis">{winningCombo.claimedSynopsis}</p>
                )}
              </>
            ) : (
              <strong>{winningCombo.points} pts</strong>
            )}
            <div className="chip-row">
              {winningCombo.cards.map((card) => (
                <CardChip key={card.id} card={card} />
              ))}
            </div>
            <p>
              {winningMovie ? (
                <>
                  🎬 <strong>{winningMovie.title}</strong>{' '}
                  <span className="muted">({winningMovie.year})</span>
                </>
              ) : (
                <span className="muted">An original pitch</span>
              )}
            </p>
          </div>
        )}

        <ol className="standings">
          {standings.map((player, index) => (
            <li key={player.id} className={winner != null && player.id === winner.id ? 'is-winner' : ''}>
              <span className="standings__rank">{index + 1}</span>
              <span className="standings__name">{player.name}</span>
              <span className="standings__detail">{declaredCards(state, player.id)} declared cards</span>
              <strong className="standings__score">
                {state.mode === 'create'
                  ? `${declaredCards(state, player.id)} pitches`
                  : `${player.score} pts`}
              </strong>
            </li>
          ))}
        </ol>

        <div className="results__actions">
          <button type="button" className="btn btn--primary" onClick={onRematch}>
            Rematch (new seed)
          </button>
          <button type="button" className="btn btn--ghost" onClick={onExit}>
            Main menu
          </button>
        </div>
        <p className="field-hint">Seed {state.seed} · {roundsPlayed} round{roundsPlayed === 1 ? '' : 's'} played</p>
      </div>
    </div>
  );
}
