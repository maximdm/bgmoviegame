import { createBoardGame, createDiceGame, createGame } from '@movie-game/shared';
import { lazy, Suspense, useEffect, useState } from 'react';
import { getMovies, loadMovies } from './data/movies';
import { randomSeed, type GameSetup } from './game/setup';

// GameScreen pulls in PixiJS (~450 KB). Lazy-load it so that heavy dependency
// stays out of the initial bundle and only downloads when a Find-a-Movie game
// actually starts.
const GameScreen = lazy(() =>
  import('./screens/GameScreen').then((module) => ({ default: module.GameScreen })),
);
import { GameStore } from './game/store';
import { BoardStore } from './game/boardStore';
import { DiceStore } from './game/diceStore';
import { BoardScreen } from './screens/BoardScreen';
import { DiceScreen } from './screens/DiceScreen';
import { MainMenu } from './screens/MainMenu';

interface ActiveGame {
  store: GameStore | BoardStore | DiceStore;
  setup: GameSetup;
}

export function App() {
  const [game, setGame] = useState<ActiveGame | null>(null);
  // Gate the UI on the dataset chunk so `getMovies()` is always ready before a
  // screen renders. The splash paints from the tiny entry chunk only.
  const [dataReady, setDataReady] = useState(false);

  useEffect(() => {
    let active = true;
    void loadMovies().then(() => {
      if (active) setDataReady(true);
    });
    return () => {
      active = false;
    };
  }, []);

  const startGame = (setup: GameSetup): void => {
    const movies = getMovies();
    if (setup.variant === 'board') {
      const state = createBoardGame(movies, {
        mode: setup.mode,
        players: setup.players,
        seed: setup.seed,
        deck: { movieCount: Math.max(60, setup.players.length * 12) },
      });
      setGame({ store: new BoardStore(state), setup });
      return;
    }
    if (setup.variant === 'dice') {
      const state = createDiceGame(movies, {
        mode: setup.mode,
        players: setup.players,
        seed: setup.seed,
        deck: { movieCount: Math.max(60, setup.players.length * 12) },
      });
      setGame({ store: new DiceStore(state), setup });
      return;
    }
    const state = createGame(movies, {
      mode: setup.mode,
      players: setup.players,
      seed: setup.seed,
      // A denser deck keeps Find-a-Movie combos feasible for small tables.
      deck: { movieCount: Math.max(8, setup.players.length * 5) },
    });
    setGame({ store: new GameStore(state), setup });
  };

  const viewerId = game?.setup.players.find((player) => player.kind === 'human')?.id ?? 'p1';

  if (!dataReady) {
    return (
      <div className="app app--loading">
        <p className="muted">Loading the movie deck…</p>
      </div>
    );
  }

  return (
    <div className="app">
      {game ? (
        game.setup.variant === 'board' ? (
          <BoardScreen
            store={game.store as BoardStore}
            viewerId={viewerId}
            hotseat={game.setup.playStyle === 'hotseat'}
            onExit={() => setGame(null)}
            onRematch={() => startGame({ ...game.setup, seed: randomSeed() })}
          />
        ) : game.setup.variant === 'dice' ? (
          <DiceScreen
            store={game.store as DiceStore}
            viewerId={viewerId}
            hotseat={game.setup.playStyle === 'hotseat'}
            onExit={() => setGame(null)}
            onRematch={() => startGame({ ...game.setup, seed: randomSeed() })}
          />
        ) : (
          <Suspense
            fallback={
              <div className="app app--loading">
                <p className="muted">Loading the game board…</p>
              </div>
            }
          >
            <GameScreen
              store={game.store as GameStore}
              viewerId={viewerId}
              hotseat={game.setup.playStyle === 'hotseat'}
              onExit={() => setGame(null)}
              onRematch={() => startGame({ ...game.setup, seed: randomSeed() })}
            />
          </Suspense>
        )
      ) : (
        <MainMenu onStart={startGame} />
      )}
    </div>
  );
}
