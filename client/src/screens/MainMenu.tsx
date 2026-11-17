import type { GameMode } from '@movie-game/shared';
import { useState } from 'react';
import { DATASET_COUNT } from '../data/movies';
import {
  MAX_LOCAL_PLAYERS,
  MIN_PLAYERS,
  defaultPlayerNames,
  randomSeed,
  type GameSetup,
  type PlayStyle,
  type Variant,
} from '../game/setup';

interface ModeInfo {
  id: GameMode;
  icon: string;
  title: string;
  tagline: string;
  description: string;
}

const MODES: readonly ModeInfo[] = [
  {
    id: 'find',
    icon: '🎬',
    title: 'Find a Movie',
    tagline: 'Match a real film',
    description:
      'Every card hides the movie it came from. A combo is valid only when all its cards belong to the same real film. Cover more categories for a bigger score.',
  },
  {
    id: 'create',
    icon: '✨',
    title: 'Create a Movie',
    tagline: 'Pitch an original film',
    description:
      'Pitch an original film built from any cards. In 4–6 players the table votes — the first pitch to earn 3 👍 wins. 2–3 players just pitch for fun, no winner.',
  },
];

interface MainMenuProps {
  onStart: (setup: GameSetup) => void;
}

export function MainMenu({ onStart }: MainMenuProps) {
  const [mode, setMode] = useState<GameMode>('find');
  const [playStyle, setPlayStyle] = useState<PlayStyle>('hotseat');
  const [variant, setVariant] = useState<Variant>('cards');
  const [playerCount, setPlayerCount] = useState(MIN_PLAYERS);
  const [names, setNames] = useState<string[]>(defaultPlayerNames(MAX_LOCAL_PLAYERS));
  const [seedText, setSeedText] = useState('');
  const [error, setError] = useState<string | null>(null);

  const humanCount = playStyle === 'hotseat' ? playerCount : 1;

  const setName = (index: number, name: string): void => {
    setNames((previous) => previous.map((value, i) => (i === index ? name : value)));
  };

  const start = (): void => {
    const seed = seedText.trim() === '' ? randomSeed() : Number(seedText.trim());
    if (!Number.isSafeInteger(seed)) {
      setError('Seed must be a whole number (or left blank).');
      return;
    }

    const players = Array.from({ length: playerCount }, (_, index) => {
      const isBot = index >= humanCount;
      return {
        id: `p${index + 1}`,
        name: isBot ? `Bot ${index}` : names[index].trim() || `Player ${index + 1}`,
        kind: isBot ? ('ai' as const) : ('human' as const),
      };
    });

    setError(null);
    onStart({ mode, playStyle, variant, players, seed });
  };

  return (
    <div className="menu">
      <section className="menu__hero">
        <p className="menu__eyebrow">A movie card game</p>
        <h1 className="menu__title">Movie Game</h1>
        <p className="menu__subtitle">
          Draw cards, spot the film hiding in your hand, and build the perfect combo. Play hotseat
          with up to six people, or take on a table of bots.
        </p>
        <div className="menu__stats">
          <span>{DATASET_COUNT} films</span>
          <span>6 categories</span>
          <span>2–6 players</span>
          <span>Hotseat or AI</span>
        </div>
      </section>

      <div className="mode-grid">
        {MODES.map((info) => (
          <button
            key={info.id}
            type="button"
            className={`mode-card ${mode === info.id ? 'is-selected' : ''}`}
            aria-pressed={mode === info.id}
            onClick={() => {
              setMode(info.id);
              // Create is human-only: force hotseat so AI can't be selected.
              if (info.id === 'create') setPlayStyle('hotseat');
            }}
          >
            <span className="mode-card__icon" aria-hidden="true">
              {info.icon}
            </span>
            <span className="mode-card__tagline">{info.tagline}</span>
            <strong className="mode-card__title">{info.title}</strong>
            <span className="mode-card__description">{info.description}</span>
          </button>
        ))}
      </div>

      <form
        className="panel setup"
        onSubmit={(event) => {
          event.preventDefault();
          start();
        }}
      >
        <div className="setup__row">
          <div className="setup__field">
            <span className="label">Play style</span>
            <div className="segmented">
              <button
                type="button"
                className={playStyle === 'hotseat' ? 'is-selected' : ''}
                aria-pressed={playStyle === 'hotseat'}
                onClick={() => setPlayStyle('hotseat')}
              >
                Hotseat
              </button>
              <button
                type="button"
                className={playStyle === 'ai' ? 'is-selected' : ''}
                aria-pressed={playStyle === 'ai'}
                disabled={mode === 'create'}
                onClick={() => setPlayStyle('ai')}
              >
                vs AI
              </button>
            </div>
            <p className="field-hint">
              {mode === 'create'
                ? 'Create a Movie is a human-only, pass-the-device game.'
                : playStyle === 'hotseat'
                  ? 'Everyone shares this device. Hands stay face-down until it is that seat’s turn.'
                  : 'You play seat 1; every other seat is a bot.'}
            </p>
          </div>

          <div className="setup__field">
            <span className="label">Variant</span>
            <div className="segmented">
              <button
                type="button"
                className={variant === 'cards' ? 'is-selected' : ''}
                aria-pressed={variant === 'cards'}
                onClick={() => setVariant('cards')}
              >
                Cards
              </button>
              <button
                type="button"
                className={variant === 'board' ? 'is-selected' : ''}
                aria-pressed={variant === 'board'}
                onClick={() => setVariant('board')}
              >
                Board
              </button>
              <button
                type="button"
                className={variant === 'dice' ? 'is-selected' : ''}
                aria-pressed={variant === 'dice'}
                onClick={() => setVariant('dice')}
              >
                Dice
              </button>
            </div>
            <p className="field-hint">
              {variant === 'board'
                ? 'Roll a die around a 16-space loop, collect colour cards, then declare a movie.'
                : variant === 'dice'
                  ? 'Roll a die each turn — its face picks which category you draw from, no board.'
                  : 'Draw, assemble a combo, then discard one card.'}
            </p>
          </div>

          <div className="setup__field">
            <span className="label">Table size</span>
            <div className="segmented">
              {Array.from({ length: MAX_LOCAL_PLAYERS - MIN_PLAYERS + 1 }, (_, index) => {
                const count = MIN_PLAYERS + index;
                return (
                  <button
                    key={count}
                    type="button"
                    className={count === playerCount ? 'is-selected' : ''}
                    aria-pressed={count === playerCount}
                    onClick={() => setPlayerCount(count)}
                  >
                    {count}
                  </button>
                );
              })}
            </div>
            <p className="field-hint">
              {mode === 'create'
                ? playerCount >= 4
                  ? '4–6 players: the table votes — first pitch to 3 👍 wins.'
                  : '2–3 players: freeform pitching, no winner.'
                : playStyle === 'hotseat'
                  ? 'Pass the device between turns.'
                  : `${playerCount - 1} bot${playerCount === 2 ? '' : 's'} at the table.`}
            </p>
          </div>

          <div className="setup__field">
            <label className="label" htmlFor="seed">
              Deck seed (optional)
            </label>
            <input
              id="seed"
              type="text"
              inputMode="numeric"
              placeholder="Random"
              value={seedText}
              onChange={(event) => setSeedText(event.target.value)}
            />
            <p className="field-hint">Use the same seed to replay an identical shuffle.</p>
          </div>
        </div>

        <div className="names-grid">
          {names.slice(0, humanCount).map((name, index) => (
            <label key={index} className="name-field">
              <span className="label">{playStyle === 'ai' ? 'Your name' : `Player ${index + 1}`}</span>
              <input
                type="text"
                maxLength={18}
                value={name}
                onChange={(event) => setName(index, event.target.value)}
              />
            </label>
          ))}
          {playStyle === 'ai' && (
            <p className="field-hint names-grid__bots">
              Bots {playerCount > 2 ? `1–${playerCount - 1}` : '1'} will take the remaining seats.
            </p>
          )}
        </div>

        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        <div className="setup__actions">
          <button type="submit" className="btn btn--primary">
            Start game
          </button>
          <span className="field-hint">
            {mode === 'find'
              ? 'Open assembly: verify against the hidden movie.'
              : 'Pitch a title + synopsis; 4–6 players vote, 2–3 just riff.'}
          </span>
        </div>
      </form>

      <section className="rules">
        <article className="panel rules__item">
          <h3>The turn</h3>
          <p>Draw one card from the deck or the top of the discard pile. Declare any combos, then discard one card to the middle.</p>
        </article>
        <article className="panel rules__item">
          <h3>Find a Movie scoring</h3>
          <p>2 points per card + categories squared, and +10 for covering all six categories. Combos need 2+ cards from 2+ categories.</p>
        </article>
        <article className="panel rules__item">
          <h3>Create a Movie</h3>
          <p>Pitch an original film from your cards — a title plus a short synopsis. With 4–6 players the table votes; the first pitch to earn 3 👍 wins. 2–3 players pitch just for fun, no winner.</p>
        </article>
        <article className="panel rules__item">
          <h3>Winning</h3>
          <p>First to 100 points wins immediately. If nobody reaches it, the highest score after 50 rounds wins — but if the top score is tied (or everyone is at zero), the game is a draw.</p>
        </article>
      </section>
    </div>
  );
}
