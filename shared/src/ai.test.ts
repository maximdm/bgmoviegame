import { describe, expect, it } from 'vitest';
import {
  DEFAULT_DECLARE_THRESHOLD,
  bestCombo,
  chooseAiAction,
  chooseDiscard,
  chooseDrawSource,
  createComboCandidates,
  findComboCandidates,
  isAiTurn,
} from './ai';
import { applyAction, createGame, DEFAULT_HAND_SIZE } from './rules';
import { FIXTURE_MOVIES } from './testFixtures';
import type { Card, Category, GameMode, GameState, PlayerState } from './types';

function card(movieId: string, category: Category, index = 0): Card {
  return {
    id: `${movieId}:${category}:${index}`,
    category,
    label: `${movieId} ${category} ${index}`,
    movieId,
  };
}

function hand(spec: Array<[string, Category]>): Card[] {
  return spec.map(([movieId, category], index) => card(movieId, category, index));
}

function makePlayer(id: string, cards: Card[] = [], score = 0, kind: PlayerState['kind'] = 'ai') {
  return { id, name: id.toUpperCase(), kind, hand: cards, score, contestsUsed: 0 };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    mode: 'find',
    players: [makePlayer('p1'), makePlayer('p2')],
    drawPile: [],
    discardPile: [],
    declared: [],
    phase: 'discard',
    currentPlayerIndex: 0,
    turn: 1,
    round: 1,
    maxRounds: 3,
    targetScore: 100,
    handSize: DEFAULT_HAND_SIZE,
    seed: 1,
    ...overrides,
  };
}

describe('bestCombo (Find)', () => {
  it('picks the movie with the widest category coverage', () => {
    const cards = hand([
      ['m1', 'Actor'],
      ['m1', 'Actress'],
      ['m1', 'Genre'],
      ['m2', 'Actor'],
      ['m3', 'Genre'],
    ]);

    const best = bestCombo('find', cards);
    expect(best).toMatchObject({ movieId: 'm1', points: 19 });
    expect(best?.cards).toHaveLength(3);
  });

  it('keeps duplicate-category cards because they add size points', () => {
    const cards = hand([
      ['m1', 'Actor'],
      ['m1', 'Actor'],
      ['m1', 'Actress'],
      ['m2', 'Genre'],
      ['m3', 'Genre'],
    ]);

    const best = bestCombo('find', cards);
    expect(best?.cards).toHaveLength(3);
    // 3 cards (2 categories): base 6, coverage 4, penalty 8 -> 6, + find bonus 10 = 16.
    expect(best?.points).toBe(16);
  });

  it('always leaves a card behind when the whole hand is one movie', () => {
    const cards = hand([
      ['m1', 'Actor'],
      ['m1', 'Actress'],
      ['m1', 'Genre'],
      ['m1', 'Setting'],
    ]);

    const best = bestCombo('find', cards);
    expect(best?.cards).toHaveLength(3);
    expect(best?.points).toBe(19);
  });

  it('returns null when no movie spans two categories', () => {
    const cards = hand([
      ['m1', 'Actor'],
      ['m2', 'Actor'],
      ['m3', 'Genre'],
    ]);
    expect(bestCombo('find', cards)).toBeNull();
    expect(findComboCandidates(cards)).toEqual([]);
  });

  it('ignores a two-card hand: nothing would be left to discard', () => {
    const cards = hand([
      ['m1', 'Actor'],
      ['m1', 'Actress'],
    ]);
    expect(bestCombo('find', cards)).toBeNull();
  });
});

describe('bestCombo (Create)', () => {
  it('prefers the real-movie pitch when its bonus wins', () => {
    const cards = hand([
      ['m1', 'Actor'],
      ['m1', 'Actress'],
      ['m2', 'Genre'],
      ['m3', 'Setting'],
      ['m4', 'Period'],
    ]);

    const best = bestCombo('create', cards);
    // Two m1 cards: base 4, + 20 real-movie bonus = 24 (beats the 16 variety pitch).
    expect(best).toMatchObject({ movieId: 'm1', points: 24 });
  });

  it('prefers the all-six-colour pitch when variety wins', () => {
    const cards = hand([
      ['m1', 'Actor'],
      ['m2', 'Actress'],
      ['m3', 'Genre'],
      ['m4', 'Setting'],
      ['m5', 'Period'],
      ['m6', 'ReleaseYear'],
      ['m7', 'Actor'],
    ]);

    const best = bestCombo('create', cards);
    // The duplicate Actor is trimmed, leaving six cards / six categories:
    // 12 + 18 + 15 = 45.
    expect(best).toMatchObject({ points: 45 });
    expect(best?.movieId).toBeUndefined();
    expect(createComboCandidates(cards).length).toBeGreaterThan(0);
  });

  it('needs two different categories', () => {
    const cards = hand([
      ['m1', 'Actor'],
      ['m2', 'Actor'],
      ['m3', 'Actor'],
    ]);
    expect(bestCombo('create', cards)).toBeNull();
  });
});

describe('chooseDiscard', () => {
  it('throws away a card outside the kept combo', () => {
    const cards = hand([
      ['m1', 'Actor'],
      ['m1', 'Actress'],
      ['m2', 'Genre'],
      ['m2', 'Setting'],
    ]);

    const discards = Array.from({ length: 6 }, () => chooseDiscard('find', cards));
    for (const discard of discards) {
      expect(discard?.movieId).toBe('m2');
    }
  });

  it('never returns null unless the hand is empty', () => {
    expect(chooseDiscard('find', [])).toBeNull();
    expect(chooseDiscard('find', hand([['m1', 'Actor']]))).not.toBeNull();
  });
});

describe('chooseDrawSource', () => {
  it('takes the top discard when it completes a combo', () => {
    const state = makeState({
      phase: 'draw',
      discardPile: [card('m1', 'Actress')],
      players: [
        makePlayer('p1', hand([['m1', 'Actor'], ['m2', 'Genre'], ['m3', 'Setting']])),
        makePlayer('p2'),
      ],
    });
    expect(chooseDrawSource(state, state.players[0])).toBe('discard');
  });

  it('draws blind when the discard adds nothing', () => {
    const state = makeState({
      phase: 'draw',
      discardPile: [card('m9', 'Actor')],
      players: [
        makePlayer('p1', hand([
          ['m1', 'Actor'],
          ['m1', 'Actress'],
          ['m2', 'Genre'],
          ['m2', 'Setting'],
        ])),
        makePlayer('p2'),
      ],
    });
    expect(chooseDrawSource(state, state.players[0])).toBe('deck');
  });

  it('draws blind when the discard pile is empty', () => {
    const state = makeState({ phase: 'draw' });
    expect(chooseDrawSource(state, state.players[0])).toBe('deck');
  });
});

describe('chooseAiAction', () => {
  it('draws during the draw phase', () => {
    const state = makeState({ phase: 'draw', drawPile: [card('m1', 'Actor')] });
    expect(chooseAiAction(state)).toEqual({ type: 'draw', playerId: 'p1', source: 'deck' });
  });

  it('holds a small combo early and discards instead', () => {
    const state = makeState({
      players: [
        makePlayer('p1', hand([
          ['m1', 'Actor'],
          ['m1', 'Actress'],
          ['m2', 'Genre'],
          ['m2', 'Setting'],
        ])),
        makePlayer('p2'),
      ],
    });

    const action = chooseAiAction(state);
    expect(action).toMatchObject({ type: 'discard', playerId: 'p1' });
  });

  it('declares once the combo reaches the default threshold', () => {
    // Three cards across three categories is 15; a fourth category lifts it to
    // 24, comfortably over `DEFAULT_DECLARE_THRESHOLD`.
    const state = makeState({
      players: [
        makePlayer('p1', hand([
          ['m1', 'Actor'],
          ['m1', 'Actress'],
          ['m1', 'Genre'],
          ['m1', 'Setting'],
          ['m2', 'Genre'],
        ])),
        makePlayer('p2'),
      ],
    });

    const action = chooseAiAction(state);
    expect(action?.type).toBe('declare');
    if (action?.type === 'declare') {
      expect(action.cardIds).toHaveLength(4);
    }
    expect(30).toBeGreaterThanOrEqual(DEFAULT_DECLARE_THRESHOLD);
  });

  it('honours a custom declaration threshold', () => {
    const state = makeState({
      players: [
        makePlayer('p1', hand([
          ['m1', 'Actor'],
          ['m1', 'Actress'],
          ['m2', 'Genre'],
          ['m2', 'Setting'],
        ])),
        makePlayer('p2'),
      ],
    });

    expect(chooseAiAction(state, 'p1', { declareThreshold: 8 })?.type).toBe('declare');
    expect(chooseAiAction(state, 'p1', { declareThreshold: 99 })?.type).toBe('discard');
  });

  it('declares anything at all in the final round', () => {
    const state = makeState({
      round: 3,
      maxRounds: 3,
      players: [
        makePlayer('p1', hand([
          ['m1', 'Actor'],
          ['m1', 'Actress'],
          ['m2', 'Genre'],
          ['m2', 'Setting'],
        ])),
        makePlayer('p2'),
      ],
    });
    expect(chooseAiAction(state)?.type).toBe('declare');
  });

  it('declares when the combo would reach the target score', () => {
    const state = makeState({
      targetScore: 100,
      players: [
        makePlayer(
          'p1',
          hand([['m1', 'Actor'], ['m1', 'Actress'], ['m1', 'Genre'], ['m2', 'Setting']]),
          85,
        ),
        makePlayer('p2'),
      ],
    });
    expect(chooseAiAction(state)?.type).toBe('declare');
  });

  it('returns null when it is not the requested seat', () => {
    const state = makeState();
    expect(chooseAiAction(state, 'p2')).toBeNull();
  });

  it('returns null once the game is over', () => {
    const state = makeState({ phase: 'gameOver', winnerId: 'p1' });
    expect(chooseAiAction(state)).toBeNull();
  });

  it('is deterministic for identical states', () => {
    const build = (): GameState =>
      makeState({
        players: [
          makePlayer('p1', hand([
            ['m1', 'Actor'],
            ['m2', 'Actress'],
            ['m3', 'Genre'],
            ['m1', 'Setting'],
          ])),
          makePlayer('p2'),
        ],
      });
    expect(chooseAiAction(build())).toEqual(chooseAiAction(build()));
  });
});

describe('isAiTurn', () => {
  it('is true only for an AI seat that is on turn', () => {
    const state = makeState({
      players: [makePlayer('p1', [], 0, 'ai'), makePlayer('p2', [], 0, 'human')],
    });
    expect(isAiTurn(state)).toBe(true);
    expect(isAiTurn({ ...state, currentPlayerIndex: 1 })).toBe(false);
    expect(isAiTurn({ ...state, phase: 'gameOver' })).toBe(false);
  });
});

describe('AI simulations', () => {
  function playOut(mode: GameMode, seed: number): GameState {
    let state = createGame(FIXTURE_MOVIES, {
      mode,
      seed,
      players: [
        { name: 'Bot A', kind: 'ai' },
        { name: 'Bot B', kind: 'ai' },
        { name: 'Bot C', kind: 'ai' },
      ],
      deck: { movieCount: 6 },
    });

    for (let step = 0; step < 500; step += 1) {
      if (state.phase === 'gameOver') break;
      const action = chooseAiAction(state);
      expect(action).not.toBeNull();
      if (!action) break;

      const result = applyAction(state, action);
      expect(result.ok).toBe(true);
      if (!result.ok) break;
      state = result.state;
    }

    return state;
  }

  it('always produces legal actions for Find mode', () => {
    const state = playOut('find', 1234);
    expect(state.phase).toBe('gameOver');
    expect(state.winnerId).toBeDefined();
    expect(state.declared.length).toBeGreaterThan(0);
  });

  it('always produces legal actions for Create mode', () => {
    const state = playOut('create', 9876);
    expect(state.phase).toBe('gameOver');
    expect(state.declared.every((combo) => combo.mode === 'create')).toBe(true);
  });

  it('is reproducible for a given seed', () => {
    const a = playOut('find', 555);
    const b = playOut('find', 555);
    expect(a.players.map((player) => player.score)).toEqual(
      b.players.map((player) => player.score),
    );
    expect(a.declared.length).toBe(b.declared.length);
  });
});
