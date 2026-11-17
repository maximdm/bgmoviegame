import { createBoardGame, createDiceGame, createGame } from '@movie-game/shared';
import { useState } from 'react';
import { MOVIES } from './data/movies';
import { randomSeed, type GameSetup } from './game/setup';
import { GameStore } from './game/store';
import { BoardStore } from './game/boardStore';
import { DiceStore } from './game/diceStore';
import { GameScreen } from './screens/GameScreen';
import { BoardScreen } from './screens/BoardScreen';
import { DiceScreen } from './screens/DiceScreen';
import { MainMenu } from './screens/MainMenu';

interface ActiveGame {
  store: GameStore | BoardStore | DiceStore;
  setup: GameSetup;
}

export function App() {
  const [game, setGame] = useState<ActiveGame | null>(null);

  const startGame = (setup: GameSetup): void => {
    if (setup.variant === 'board') {
      const state = createBoardGame(MOVIES, {
        mode: setup.mode,
        players: setup.players,
        seed: setup.seed,
        deck: { movieCount: Math.max(60, setup.players.length * 12) },
      });
      setGame({ store: new BoardStore(state), setup });
      return;
    }
    if (setup.variant === 'dice') {
      const state = createDiceGame(MOVIES, {
        mode: setup.mode,
        players: setup.players,
        seed: setup.seed,
        deck: { movieCount: Math.max(60, setup.players.length * 12) },
      });
      setGame({ store: new DiceStore(state), setup });
      return;
    }
    const state = createGame(MOVIES, {
      mode: setup.mode,
      players: setup.players,
      seed: setup.seed,
      // A denser deck keeps Find-a-Movie combos feasible for small tables.
      deck: { movieCount: Math.max(8, setup.players.length * 5) },
    });
    setGame({ store: new GameStore(state), setup });
  };

  const viewerId = game?.setup.players.find((player) => player.kind === 'human')?.id ?? 'p1';

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
          <GameScreen
            store={game.store as GameStore}
            viewerId={viewerId}
            hotseat={game.setup.playStyle === 'hotseat'}
            onExit={() => setGame(null)}
            onRematch={() => startGame({ ...game.setup, seed: randomSeed() })}
          />
        )
      ) : (
        <MainMenu onStart={startGame} />
      )}
    </div>
  );
}
