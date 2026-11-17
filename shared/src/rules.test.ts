import { describe, expect, it } from 'vitest';
import {
  DEFAULT_HAND_SIZE,
  DEFAULT_MAX_ROUNDS,
  DEFAULT_TARGET_SCORE,
  MAX_PLAYERS,
  applyAction,
  createGame,
} from './rules';
import { FIXTURE_MOVIES } from './testFixtures';
import type {
  ActionResult,
  Card,
  Category,
  DeclaredCombo,
  GameState,
  PlayerState,
} from './types';

const ALL_CATEGORIES: readonly Category[] = [
  'Actor',
  'Actress',
  'Period',
  'Setting',
  'ReleaseYear',
  'Genre',
];

function card(movieId: string, category: Category, index = 0): Card {
  return {
    id: `${movieId}:${category}:${index}`,
    category,
    label: `${movieId} ${category} ${index}`,
    movieId,
  };
}

function fullCombo(movieId: string): Card[] {
  return ALL_CATEGORIES.map((category) => card(movieId, category));
}

function makePlayer(
  id: string,
  hand: Card[] = [],
  score = 0,
  kind: PlayerState['kind'] = 'human',
): PlayerState {
  return { id, name: id.toUpperCase(), kind, hand, score, contestsUsed: 0 };
}

function makeState(overrides: Partial<GameState> = {}): GameState {
  return {
    mode: 'find',
    players: [makePlayer('p1'), makePlayer('p2')],
    drawPile: [],
    discardPile: [],
    declared: [],
    phase: 'draw',
    currentPlayerIndex: 0,
    turn: 1,
    round: 1,
    maxRounds: DEFAULT_MAX_ROUNDS,
    targetScore: DEFAULT_TARGET_SCORE,
    handSize: DEFAULT_HAND_SIZE,
    seed: 1,
    ...overrides,
  };
}

function expectOk(result: ActionResult): GameState {
  expect(result.ok).toBe(true);
  if (!result.ok) throw new Error(result.error);
  return result.state;
}

function expectError(result: ActionResult, message: string): void {
  expect(result.ok).toBe(false);
  if (!result.ok) expect(result.error).toBe(message);
}

function combo(overrides: Partial<DeclaredCombo> = {}): DeclaredCombo {
  return {
    id: 'combo-1',
    playerId: 'p2',
    mode: 'find',
    cards: [card('m1', 'Actor'), card('m1', 'Actress')],
    points: 8,
    movieId: 'm1',
    verified: false,
    castPenalty: 0,
    turn: 1,
    ...overrides,
  };
}

describe('createGame', () => {
  it('deals opening hands and starts on the first player', () => {
    const state = createGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 2024,
      players: [{ name: 'A' }, { name: 'B' }, { name: 'C' }],
      deck: { movieCount: 6 },
    });

    expect(state.players.map((player) => player.id)).toEqual(['p1', 'p2', 'p3']);
    expect(state.players.every((player) => player.hand.length === DEFAULT_HAND_SIZE)).toBe(true);
    expect(state.players.every((player) => player.score === 0)).toBe(true);
    expect(state.phase).toBe('draw');
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.turn).toBe(1);
    expect(state.round).toBe(1);
    expect(state.maxRounds).toBe(DEFAULT_MAX_ROUNDS);
    expect(state.targetScore).toBe(DEFAULT_TARGET_SCORE);
    expect(state.declared).toEqual([]);
    expect(state.discardPile).toEqual([]);
    expect(state.seed).toBe(2024);
  });

  it('never duplicates a physical card between hands and the draw pile', () => {
    const state = createGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 7,
      players: [{ name: 'A' }, { name: 'B' }],
      deck: { movieCount: 6 },
    });
    const allCards = [...state.players.flatMap((player) => player.hand), ...state.drawPile];
    expect(new Set(allCards.map((c) => c.id)).size).toBe(allCards.length);
  });

  it('accepts custom player ids and kinds', () => {
    const state = createGame(FIXTURE_MOVIES, {
      mode: 'create',
      seed: 7,
      players: [
        { id: 'alice', name: 'Alice', kind: 'human' },
        { id: 'bot', name: 'Bot', kind: 'ai' },
      ],
      deck: { movieCount: 6 },
    });
    expect(state.players[0].id).toBe('alice');
    expect(state.players[1].kind).toBe('ai');
    expect(state.mode).toBe('create');
  });

  it('rejects an empty or oversized player list', () => {
    expect(() => createGame(FIXTURE_MOVIES, { mode: 'find', players: [] })).toThrow(
      /At least one player/,
    );

    const tooMany = Array.from({ length: MAX_PLAYERS + 1 }, (_, index) => ({
      name: `P${index}`,
    }));
    expect(() => createGame(FIXTURE_MOVIES, { mode: 'find', players: tooMany })).toThrow(
      /at most 6 players/i,
    );
  });

  it('rejects invalid configuration values', () => {
    const players = [{ name: 'A' }];
    expect(() => createGame(FIXTURE_MOVIES, { mode: 'find', players, handSize: 0 })).toThrow(
      /Hand size/,
    );
    expect(() => createGame(FIXTURE_MOVIES, { mode: 'find', players, targetScore: 0 })).toThrow(
      /Target score/,
    );
    expect(() => createGame(FIXTURE_MOVIES, { mode: 'find', players, maxRounds: 0 })).toThrow(
      /Max rounds/,
    );
  });

  it('throws when the deck cannot cover every opening hand', () => {
    expect(() =>
      createGame(FIXTURE_MOVIES, {
        mode: 'find',
        players: [{ name: 'A' }, { name: 'B' }],
        handSize: 100,
        deck: { movieCount: 6 },
      }),
    ).toThrow(/Not enough cards/);
  });
});

describe('drawing', () => {
  it('draws from the deck and moves to the discard phase', () => {
    const bottom = card('m1', 'Actor');
    const top = card('m1', 'Actress');
    const state = makeState({ drawPile: [bottom, top], players: [makePlayer('p1'), makePlayer('p2')] });

    const next = expectOk(applyAction(state, { type: 'draw', playerId: 'p1', source: 'deck' }));

    expect(next.players[0].hand).toEqual([top]);
    expect(next.drawPile).toEqual([bottom]);
    expect(next.phase).toBe('discard');
    expect(next.turn).toBe(1);
    // The original state is untouched.
    expect(state.drawPile).toEqual([bottom, top]);
    expect(state.players[0].hand).toEqual([]);
  });

  it('draws the top card of the discard pile', () => {
    const bottom = card('m1', 'Actor');
    const top = card('m1', 'Actress');
    const state = makeState({ discardPile: [bottom, top] });

    const next = expectOk(applyAction(state, { type: 'draw', playerId: 'p1', source: 'discard' }));

    expect(next.players[0].hand).toEqual([top]);
    expect(next.discardPile).toEqual([bottom]);
    expect(next.phase).toBe('discard');
  });

  it('rejects drawing from an empty discard pile', () => {
    const state = makeState();
    expectError(
      applyAction(state, { type: 'draw', playerId: 'p1', source: 'discard' }),
      'The discard pile is empty.',
    );
  });

  it('rejects drawing twice in one turn', () => {
    const state = makeState({ phase: 'discard', players: [makePlayer('p1', [card('m1', 'Actor')])] });
    expectError(
      applyAction(state, { type: 'draw', playerId: 'p1', source: 'deck' }),
      'You must draw a card first.',
    );
  });

  it('reshuffles the discard pile when the deck runs out, keeping its top card', () => {
    const a = card('m1', 'Actor');
    const b = card('m1', 'Actress');
    const c = card('m1', 'Genre');
    const state = makeState({ drawPile: [], discardPile: [a, b, c], turn: 5, seed: 99 });

    const next = expectOk(applyAction(state, { type: 'draw', playerId: 'p1', source: 'deck' }));

    expect(next.discardPile).toEqual([c]);
    expect(next.drawPile).toHaveLength(1);
    expect(next.players[0].hand).toHaveLength(1);
    expect([a, b]).toContainEqual(next.players[0].hand[0]);
    expect(next.phase).toBe('discard');
  });

  it('ends the game when no card can be drawn anywhere', () => {
    const state = makeState({
      players: [makePlayer('p1', [], 10), makePlayer('p2', [], 5)],
      drawPile: [],
      discardPile: [card('m1', 'Actor')],
    });

    const next = expectOk(applyAction(state, { type: 'draw', playerId: 'p1', source: 'deck' }));

    expect(next.phase).toBe('gameOver');
    expect(next.winnerId).toBe('p1');
  });
});

describe('discarding', () => {
  it('moves the discarded card to the middle and passes the turn', () => {
    // Discarding is only allowed at a full hand (7+), so give p1 a complete hand.
    const hand = [...fullCombo('m1'), card('m2', 'Genre')];
    const throwAway = hand[hand.length - 1];
    const keepers = hand.slice(0, hand.length - 1);
    const state = makeState({
      phase: 'discard',
      players: [makePlayer('p1', hand), makePlayer('p2')],
      drawPile: [],
    });

    const next = expectOk(
      applyAction(state, { type: 'discard', playerId: 'p1', cardId: throwAway.id }),
    );

    expect(next.players[0].hand).toEqual(keepers);
    expect(next.discardPile).toEqual([throwAway]);
    expect(next.currentPlayerIndex).toBe(1);
    expect(next.turn).toBe(2);
    expect(next.round).toBe(1);
    expect(next.phase).toBe('draw');
  });

  it('rejects discarding before drawing', () => {
    const kept = card('m1', 'Actor');
    const state = makeState({ players: [makePlayer('p1', [kept]), makePlayer('p2')] });
    expectError(
      applyAction(state, { type: 'discard', playerId: 'p1', cardId: kept.id }),
      'Draw a card before discarding.',
    );
  });

  it('rejects discarding a card that is not in hand', () => {
    const state = makeState({ phase: 'discard', players: [makePlayer('p1', [card('m1', 'Actor')])] });
    expectError(
      applyAction(state, { type: 'discard', playerId: 'p1', cardId: 'missing' }),
      'That card is not in your hand.',
    );
  });

  it('starts round 2 after the last seat discards', () => {
    const state = createGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 55,
      players: [{ name: 'A' }, { name: 'B' }],
      deck: { movieCount: 6 },
    });

    const afterP1Draw = expectOk(
      applyAction(state, { type: 'draw', playerId: 'p1', source: 'deck' }),
    );
    const afterP1Discard = expectOk(
      applyAction(afterP1Draw, {
        type: 'discard',
        playerId: 'p1',
        cardId: afterP1Draw.players[0].hand[0].id,
      }),
    );
    expect(afterP1Discard.currentPlayerIndex).toBe(1);
    expect(afterP1Discard.round).toBe(1);

    const afterP2Draw = expectOk(
      applyAction(afterP1Discard, { type: 'draw', playerId: 'p2', source: 'deck' }),
    );
    const afterP2Discard = expectOk(
      applyAction(afterP2Draw, {
        type: 'discard',
        playerId: 'p2',
        cardId: afterP2Draw.players[1].hand[0].id,
      }),
    );

    expect(afterP2Discard.currentPlayerIndex).toBe(0);
    expect(afterP2Discard.round).toBe(2);
    expect(afterP2Discard.turn).toBe(3);
    expect(afterP2Discard.phase).toBe('draw');
  });

  it('ends the game after the final round', () => {
    let state = createGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 77,
      maxRounds: 1,
      players: [{ name: 'A' }, { name: 'B' }],
      deck: { movieCount: 6 },
    });

    for (const playerId of ['p1', 'p2'] as const) {
      const drawn = expectOk(applyAction(state, { type: 'draw', playerId, source: 'deck' }));
      const index = state.currentPlayerIndex;
      state = expectOk(
        applyAction(drawn, { type: 'discard', playerId, cardId: drawn.players[index].hand[0].id }),
      );
    }

    expect(state.phase).toBe('gameOver');
    expect(state.round).toBe(1);
    // Nobody scored in a single round, so it is a draw (not an arbitrary winner).
    expect(state.winnerId).toBeUndefined();
    expect(state.draw).toBe(true);
  });
});

describe('round-limit end (no scoreless win)', () => {
  /** Play out a single-round game at the round limit with the given scores. */
  function playOneRoundAndEnd(scores: [number, number]): GameState {
    const state = createGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 77,
      maxRounds: 1,
      players: [{ name: 'A' }, { name: 'B' }],
      deck: { movieCount: 6 },
    });
    // `createGame` resets scores to 0, so set them after creation.
    state.players[0].score = scores[0];
    state.players[1].score = scores[1];
    let current = state;
    for (const playerId of ['p1', 'p2'] as const) {
      const drawn = expectOk(applyAction(current, { type: 'draw', playerId, source: 'deck' }));
      const index = current.currentPlayerIndex;
      current = expectOk(
        applyAction(drawn, { type: 'discard', playerId, cardId: drawn.players[index].hand[0].id }),
      );
    }
    return current;
  }

  it('is a draw when nobody scored', () => {
    const state = playOneRoundAndEnd([0, 0]);
    expect(state.phase).toBe('gameOver');
    expect(state.winnerId).toBeUndefined();
    expect(state.draw).toBe(true);
  });

  it('is a draw when the top score is tied', () => {
    const state = playOneRoundAndEnd([10, 10]);
    expect(state.winnerId).toBeUndefined();
    expect(state.draw).toBe(true);
  });

  it('names a single leader at the round limit', () => {
    const state = playOneRoundAndEnd([12, 5]);
    expect(state.winnerId).toBe('p1');
    expect(state.draw).toBe(false);
  });
});

describe('turn ownership', () => {
  it('rejects actions from a player who is not on turn', () => {
    const state = makeState({
      currentPlayerIndex: 1,
      players: [makePlayer('p1'), makePlayer('p2')],
    });
    expectError(
      applyAction(state, { type: 'draw', playerId: 'p1', source: 'deck' }),
      "It is P2's turn.",
    );
  });

  it('rejects every action once the game is over', () => {
    const state = makeState({ phase: 'gameOver', winnerId: 'p1' });
    expectError(
      applyAction(state, { type: 'draw', playerId: 'p1', source: 'deck' }),
      'The game is over.',
    );
  });
});

describe('declaring combos', () => {
  it('holds all points in a pending declaration until verified (human)', () => {
    const actor = card('m1', 'Actor');
    const actress = card('m1', 'Actress');
    const spare = card('m2', 'Genre');
    const state = makeState({
      phase: 'discard',
      players: [makePlayer('p1', [actor, actress, spare]), makePlayer('p2')],
    });

    const declared = expectOk(
      applyAction(state, {
        type: 'declare',
        playerId: 'p1',
        cardIds: [actor.id, actress.id],
        claimedTitle: 'The Right Movie',
      }),
    );

    // Points are held: nothing scored yet, nothing declared yet. Declaring ends
    // the turn, so play passes to the next seat while verification is open.
    expect(declared.players[0].score).toBe(0);
    expect(declared.players[0].hand).toEqual([spare]);
    expect(declared.phase).toBe('draw');
    expect(declared.currentPlayerIndex).toBe(1);
    expect(declared.declared).toHaveLength(0);
    expect(declared.pendingDeclaration).toMatchObject({
      playerId: 'p1',
      mode: 'find',
      basePoints: 4,
      bonusPoints: 10,
      claimedTitle: 'The Right Movie',
      turn: 1,
    });
    expect(declared.pendingDeclaration?.cards).toEqual([actor, actress]);

    // Verifying the claim awards base + bonus.
    const resolved = expectOk(
      applyAction(declared, { type: 'resolveDeclaration', playerId: 'p2', outcome: 'real' }),
    );
    expect(resolved.players[0].score).toBe(14);
    expect(resolved.pendingDeclaration).toBeUndefined();
    expect(resolved.declared).toHaveLength(1);
    expect(resolved.declared[0]).toMatchObject({
      playerId: 'p1',
      mode: 'find',
      points: 14,
      claimedTitle: 'The Right Movie',
      verified: true,
      turn: 1,
    });
  });

  it('docks a -10 penalty when a combo has no Actor or Actress', () => {
    const genre = card('m1', 'Genre');
    const setting = card('m1', 'Setting');
    const spare = card('m2', 'Period');
    const state = makeState({
      phase: 'discard',
      players: [makePlayer('p1', [genre, setting, spare]), makePlayer('p2')],
    });

    const declared = expectOk(
      applyAction(state, {
        type: 'declare',
        playerId: 'p1',
        cardIds: [genre.id, setting.id],
        claimedTitle: 'Castless',
      }),
    );
    expect(declared.pendingDeclaration?.castPenalty).toBe(10);

    const resolved = expectOk(
      applyAction(declared, { type: 'resolveDeclaration', playerId: 'p2', outcome: 'real' }),
    );
    // base 4 + bonus 10 − 10 no-cast penalty = 4.
    expect(resolved.players[0].score).toBe(4);
    expect(resolved.declared[0]).toMatchObject({ points: 4, castPenalty: 10 });
  });

  it('does not penalize a combo that includes an Actor or Actress', () => {
    const actor = card('m1', 'Actor');
    const genre = card('m1', 'Genre');
    const spare = card('m2', 'Setting');
    const state = makeState({
      phase: 'discard',
      players: [makePlayer('p1', [actor, genre, spare]), makePlayer('p2')],
    });

    const declared = expectOk(
      applyAction(state, {
        type: 'declare',
        playerId: 'p1',
        cardIds: [actor.id, genre.id],
        claimedTitle: 'Has a lead',
      }),
    );
    expect(declared.pendingDeclaration?.castPenalty).toBe(0);

    const resolved = expectOk(
      applyAction(declared, { type: 'resolveDeclaration', playerId: 'p2', outcome: 'real' }),
    );
    // base 4 + bonus 10, no cast penalty = 14.
    expect(resolved.players[0].score).toBe(14);
    expect(resolved.declared[0]).toMatchObject({ points: 14, castPenalty: 0 });
  });

  it('awards the all-six bonus only once verified', () => {
    const combo = fullCombo('m1');
    const spare = card('m2', 'Genre');
    const state = makeState({
      phase: 'discard',
      players: [makePlayer('p1', [...combo, spare]), makePlayer('p2')],
    });

    const declared = expectOk(
      applyAction(state, {
        type: 'declare',
        playerId: 'p1',
        cardIds: combo.map((c) => c.id),
        claimedTitle: 'Six-Color Film',
      }),
    );
    expect(declared.pendingDeclaration?.basePoints).toBe(58);
    expect(declared.pendingDeclaration?.bonusPoints).toBe(10);

    const resolved = expectOk(
      applyAction(declared, { type: 'resolveDeclaration', playerId: 'p2', outcome: 'real' }),
    );
    expect(resolved.players[0].score).toBe(68);
    expect(resolved.declared[0].points).toBe(68);
  });

  it('requires resolving a pending declaration before discarding', () => {
    const actor = card('m1', 'Actor');
    const actress = card('m1', 'Actress');
    const state = makeState({
      phase: 'discard',
      players: [
        // p1 holds a complete hand; declaring two cards refills it from the pile.
        makePlayer('p1', [...fullCombo('m1'), card('m2', 'Genre')]),
        makePlayer('p2', [...fullCombo('m3'), card('m4', 'Genre')]),
      ],
      // Enough cards for p1's refill (2) and p2's later draw (1).
      drawPile: [
        card('d1', 'Actor', 1),
        card('d2', 'Actress', 1),
        card('d3', 'Setting', 1),
      ],
      discardPile: [card('m7', 'Setting')],
    });

    const declared = expectOk(
      applyAction(state, {
        type: 'declare',
        playerId: 'p1',
        cardIds: [actor.id, actress.id],
        claimedTitle: 'X',
      }),
    );
    // Declaring ends p1's turn; play passes to p2 while verification is open.
    expect(declared.currentPlayerIndex).toBe(1);
    expect(declared.phase).toBe('draw');

    // p2 cannot discard while the declaration is still pending.
    expectError(
      applyAction(declared, { type: 'discard', playerId: 'p2', cardId: card('m4', 'Genre').id }),
      'Resolve the pending declaration before discarding.',
    );

    // After p2 verifies the claim, it can finish its own turn normally.
    const verified = expectOk(
      applyAction(declared, { type: 'resolveDeclaration', playerId: 'p2', outcome: 'real' }),
    );
    expect(verified.pendingDeclaration).toBeUndefined();
    const drawn = expectOk(
      applyAction(verified, { type: 'draw', playerId: 'p2', source: 'deck' }),
    );
    expect(drawn.phase).toBe('discard');
    const finished = expectOk(
      applyAction(drawn, {
        type: 'discard',
        playerId: 'p2',
        cardId: drawn.players[1].hand[0].id,
      }),
    );
    expect(finished.currentPlayerIndex).toBe(0);
    expect(finished.phase).toBe('draw');
  });

  it('rejects declaring the entire hand', () => {
    const actor = card('m1', 'Actor');
    const actress = card('m1', 'Actress');
    const state = makeState({
      phase: 'discard',
      players: [makePlayer('p1', [actor, actress]), makePlayer('p2')],
    });
    expectError(
      applyAction(state, {
        type: 'declare',
        playerId: 'p1',
        cardIds: [actor.id, actress.id],
      }),
      'Keep at least one card to discard.',
    );
  });

  it('accepts a Find-a-Movie combo that mixes movies (no hidden answer)', () => {
    const actor = card('m1', 'Actor');
    const actress = card('m2', 'Actress');
    const spare = card('m3', 'Genre');
    const state = makeState({
      phase: 'discard',
      players: [makePlayer('p1', [actor, actress, spare]), makePlayer('p2')],
    });

    const result = applyAction(state, {
      type: 'declare',
      playerId: 'p1',
      cardIds: [actor.id, actress.id],
      claimedTitle: 'Whatever',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.state.pendingDeclaration).toMatchObject({
      basePoints: 4,
      claimedTitle: 'Whatever',
    });
    expect(result.state.declared).toHaveLength(0);
  });

  it('rejects a Find-a-Movie combo that covers only one category', () => {
    const first = card('m1', 'Actor', 0);
    const second = card('m1', 'Actor', 1);
    const spare = card('m2', 'Genre');
    const state = makeState({
      phase: 'discard',
      players: [makePlayer('p1', [first, second, spare]), makePlayer('p2')],
    });

    const result = applyAction(state, {
      type: 'declare',
      playerId: 'p1',
      cardIds: [first.id, second.id],
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/2 different categories/);
  });

  it('rejects duplicate card ids', () => {
    const actor = card('m1', 'Actor');
    const actress = card('m1', 'Actress');
    const spare = card('m2', 'Genre');
    const state = makeState({
      phase: 'discard',
      players: [makePlayer('p1', [actor, actress, spare]), makePlayer('p2')],
    });
    expectError(
      applyAction(state, {
        type: 'declare',
        playerId: 'p1',
        cardIds: [actor.id, actor.id],
      }),
      'The same card was selected twice.',
    );
  });

  it('rejects cards that are not in the hand', () => {
    const state = makeState({
      phase: 'discard',
      players: [makePlayer('p1', [card('m1', 'Actor')]), makePlayer('p2')],
    });
    expectError(
      applyAction(state, { type: 'declare', playerId: 'p1', cardIds: ['missing'] }),
      'That card is not in your hand.',
    );
  });

  it('rejects declaring before drawing', () => {
    const actor = card('m1', 'Actor');
    const state = makeState({ players: [makePlayer('p1', [actor]), makePlayer('p2')] });
    expectError(
      applyAction(state, { type: 'declare', playerId: 'p1', cardIds: [actor.id] }),
      'Draw a card before declaring a combo.',
    );
  });

  it('records a freeform pitch immediately in Create mode (2–3 players, no winner)', () => {
    const actor = card('m1', 'Actor');
    const actress = card('m2', 'Actress');
    const spare = card('m3', 'Genre');
    const state = makeState({
      mode: 'create',
      phase: 'discard',
      players: [makePlayer('p1', [actor, actress, spare]), makePlayer('p2')],
    });

    const declared = expectOk(
      applyAction(state, {
        type: 'declare',
        playerId: 'p1',
        cardIds: [actor.id, actress.id],
        claimedTitle: 'My Pitch',
        claimedSynopsis: 'A lighthouse keeper and the sea.',
      }),
    );

    // No scoring, no pending window, no winner in the freeform tier.
    expect(declared.players[0].score).toBe(0);
    expect(declared.pendingDeclaration).toBeUndefined();
    expect(declared.phase).not.toBe('gameOver');
    expect(declared.winnerId).toBeUndefined();
    expect(declared.declared[0]).toMatchObject({
      mode: 'create',
      points: 0,
      claimedTitle: 'My Pitch',
      claimedSynopsis: 'A lighthouse keeper and the sea.',
      verified: true,
    });
  });

  it('opens a thumbs-up voting window for Create mode (4–6 players)', () => {
    const actor = card('m1', 'Actor');
    const actress = card('m2', 'Actress');
    const spare = card('m3', 'Genre');
    const state = makeState({
      mode: 'create',
      phase: 'discard',
      players: [
        makePlayer('p1', [actor, actress, spare]),
        makePlayer('p2'),
        makePlayer('p3'),
        makePlayer('p4'),
      ],
    });

    const pitched = expectOk(
      applyAction(state, {
        type: 'declare',
        playerId: 'p1',
        cardIds: [actor.id, actress.id],
        claimedTitle: 'Midnight Cartography',
        claimedSynopsis: 'Two strangers redraw a city.',
      }),
    );

    expect(pitched.pendingDeclaration).toMatchObject({
      mode: 'create',
      playerId: 'p1',
      claimedTitle: 'Midnight Cartography',
      claimedSynopsis: 'Two strangers redraw a city.',
      votes: {},
    });

    // The declarer cannot vote on their own pitch, and a duplicate vote is rejected.
    expectError(
      applyAction(pitched, { type: 'vote', playerId: 'p1', declarationId: 'pending-1', vote: 'up' }),
      'You cannot vote on your own pitch.',
    );

    const one = expectOk(
      applyAction(pitched, { type: 'vote', playerId: 'p2', declarationId: 'pending-1', vote: 'up' }),
    );
    expect(one.pendingDeclaration?.votes).toEqual({ p2: 'up' });
    expectError(
      applyAction(one, { type: 'vote', playerId: 'p2', declarationId: 'pending-1', vote: 'up' }),
      'You have already voted on this pitch.',
    );

    // Three thumbs up wins the game for the declarer.
    const two = expectOk(
      applyAction(one, { type: 'vote', playerId: 'p3', declarationId: 'pending-1', vote: 'up' }),
    );
    const three = expectOk(
      applyAction(two, { type: 'vote', playerId: 'p4', declarationId: 'pending-1', vote: 'up' }),
    );
    expect(three.phase).toBe('gameOver');
    expect(three.winnerId).toBe('p1');
    expect(three.declared[0]).toMatchObject({ mode: 'create', verified: true });
  });

  it('fails a Create pitch that falls short of three thumbs up', () => {
    const actor = card('m1', 'Actor');
    const actress = card('m2', 'Actress');
    const spare = card('m3', 'Genre');
    const state = makeState({
      mode: 'create',
      phase: 'discard',
      players: [
        makePlayer('p1', [actor, actress, spare]),
        makePlayer('p2'),
        makePlayer('p3'),
        makePlayer('p4'),
      ],
    });

    const pitched = expectOk(
      applyAction(state, {
        type: 'declare',
        playerId: 'p1',
        cardIds: [actor.id, actress.id],
        claimedTitle: 'Gravity’s Anthem',
      }),
    );

    // Every non-declarer thumbs down → all voted, fewer than three 👍 → pitch fails.
    const a = expectOk(
      applyAction(pitched, { type: 'vote', playerId: 'p2', declarationId: 'pending-1', vote: 'down' }),
    );
    const b = expectOk(
      applyAction(a, { type: 'vote', playerId: 'p3', declarationId: 'pending-1', vote: 'down' }),
    );
    const c = expectOk(
      applyAction(b, { type: 'vote', playerId: 'p4', declarationId: 'pending-1', vote: 'down' }),
    );

    expect(c.pendingDeclaration).toBeUndefined();
    expect(c.phase).not.toBe('gameOver');
    expect(c.winnerId).toBeUndefined();
    expect(c.declared[0]).toMatchObject({ mode: 'create', verified: false, points: 0 });
  });

  it('requires UNANIMOUS approval in a 5-player Create game (all 4 others must thumb up)', () => {
    const actor = card('m1', 'Actor');
    const actress = card('m2', 'Actress');
    const spare = card('m3', 'Genre');
    const players = [
      makePlayer('p1', [actor, actress, spare]),
      makePlayer('p2'),
      makePlayer('p3'),
      makePlayer('p4'),
      makePlayer('p5'),
    ];
    const state = makeState({ mode: 'create', phase: 'discard', players });

    const pitched = expectOk(
      applyAction(state, {
        type: 'declare',
        playerId: 'p1',
        cardIds: [actor.id, actress.id],
        claimedTitle: 'Quorum',
      }),
    );
    // 3 of 4 thumbs up is NOT enough at 5 players (old rule would have won here).
    let s = pitched;
    for (const id of ['p2', 'p3', 'p4']) {
      s = expectOk(applyAction(s, { type: 'vote', playerId: id, declarationId: 'pending-1', vote: 'up' }));
    }
    expect(s.phase).not.toBe('gameOver');
    expect(s.winnerId).toBeUndefined();
    // The 4th (and final) other player thumbs up → unanimous → win.
    const won = expectOk(
      applyAction(s, { type: 'vote', playerId: 'p5', declarationId: 'pending-1', vote: 'up' }),
    );
    expect(won.phase).toBe('gameOver');
    expect(won.winnerId).toBe('p1');
  });

  it('requires UNANIMOUS approval in a 6-player Create game (all 5 others must thumb up)', () => {
    const actor = card('m1', 'Actor');
    const actress = card('m2', 'Actress');
    const spare = card('m3', 'Genre');
    const players = [
      makePlayer('p1', [actor, actress, spare]),
      makePlayer('p2'),
      makePlayer('p3'),
      makePlayer('p4'),
      makePlayer('p5'),
      makePlayer('p6'),
    ];
    const state = makeState({ mode: 'create', phase: 'discard', players });

    const pitched = expectOk(
      applyAction(state, {
        type: 'declare',
        playerId: 'p1',
        cardIds: [actor.id, actress.id],
        claimedTitle: 'Full Table',
      }),
    );
    // 3 of 5 thumbs up (the old winning bar) no longer wins at 6 players.
    let s = pitched;
    for (const id of ['p2', 'p3', 'p4']) {
      s = expectOk(applyAction(s, { type: 'vote', playerId: id, declarationId: 'pending-1', vote: 'up' }));
    }
    expect(s.phase).not.toBe('gameOver');
    // A single thumbs-down among the rest dooms the pitch even if everyone else agrees.
    s = expectOk(applyAction(s, { type: 'vote', playerId: 'p5', declarationId: 'pending-1', vote: 'down' }));
    s = expectOk(applyAction(s, { type: 'vote', playerId: 'p6', declarationId: 'pending-1', vote: 'up' }));
    expect(s.phase).not.toBe('gameOver');
    expect(s.winnerId).toBeUndefined();
    expect(s.declared[0]).toMatchObject({ mode: 'create', verified: false });
  });
});

describe('contesting declarations', () => {
  function declaredPending(
    overrides: Partial<GameState> = {},
  ): GameState {
    const state = makeState({
      mode: 'find',
      phase: 'discard',
      players: [
        makePlayer('p1', [card('m1', 'Actor'), card('m1', 'Actress'), card('m2', 'Genre')]),
        makePlayer('p2'),
        makePlayer('p3'),
      ],
      ...overrides,
    });
    const declared = applyAction(state, {
      type: 'declare',
      playerId: 'p1',
      cardIds: ['m1:Actor:0', 'm1:Actress:0'],
      claimedTitle: 'Contested Film',
    });
    if (!declared.ok) throw new Error(declared.error);
    return declared.state;
  }

  it('lets another player contest, then penalises a wrong contest', () => {
    const state = declaredPending();
    expect(state.pendingDeclaration?.contests).toEqual([]);

    const contested = expectOk(
      applyAction(state, { type: 'contest', playerId: 'p2', declarationId: 'pending-1', proof: 'Wrong year' }),
    );
    expect(contested.pendingDeclaration?.contests).toEqual([{ playerId: 'p2', proof: 'Wrong year' }]);
    expect(contested.players[1].contestsUsed).toBe(1);

    // Resolving as real: the challenger contested a correct film, so -5.
    const resolved = expectOk(
      applyAction(contested, { type: 'resolveDeclaration', playerId: 'p3', outcome: 'real' }),
    );
    expect(resolved.players[0].score).toBe(14); // declarer awarded (4 base + 10 bonus)
    expect(resolved.players[1].score).toBe(-5); // wrong contest penalty
  });

  it('does not penalise a correct contest that exposes a fake claim', () => {
    const state = declaredPending();
    const contested = expectOk(
      applyAction(state, { type: 'contest', playerId: 'p2', declarationId: 'pending-1' }),
    );
    const resolved = expectOk(
      applyAction(contested, { type: 'resolveDeclaration', playerId: 'p3', outcome: 'fake' }),
    );
    expect(resolved.players[0].score).toBe(-5); // fake claim penalty
    expect(resolved.players[1].score).toBe(0); // correct contest, no penalty
  });

  it('limits a player to three contests per game', () => {
    const state = declaredPending();
    // A player who has already used three contests cannot raise another.
    state.players[1].contestsUsed = 3;
    expectError(
      applyAction(state, { type: 'contest', playerId: 'p2', declarationId: 'pending-1' }),
      'You have no contests left this game.',
    );
  });

  it('rejects contesting your own declaration', () => {
    const state = declaredPending();
    expectError(
      applyAction(state, { type: 'contest', playerId: 'p1', declarationId: 'pending-1' }),
      'You cannot contest your own declaration.',
    );
  });

  it('rejects a contest once the declaration is resolved', () => {
    const state = declaredPending();
    const resolved = expectOk(
      applyAction(state, { type: 'resolveDeclaration', playerId: 'p3', outcome: 'real' }),
    );
    expectError(
      applyAction(resolved, { type: 'contest', playerId: 'p2', declarationId: 'pending-1' }),
      'No declaration is open to contest.',
    );
  });
});

describe('winning', () => {
  it('wins when a verified declaration reaches the target score', () => {
    const actor = card('m1', 'Actor');
    const actress = card('m1', 'Actress');
    const spare = card('m2', 'Genre');
    const state = makeState({
      phase: 'discard',
      targetScore: 4,
      players: [makePlayer('p1', [actor, actress, spare]), makePlayer('p2')],
    });

    // The held points do not win on their own. Declaring ends the turn.
    const declared = expectOk(
      applyAction(state, {
        type: 'declare',
        playerId: 'p1',
        cardIds: [actor.id, actress.id],
        claimedTitle: 'Winner',
      }),
    );
    expect(declared.phase).toBe('draw');
    expect(declared.currentPlayerIndex).toBe(1);

    // Verifying crosses the target and ends the game.
    const next = expectOk(
      applyAction(declared, { type: 'resolveDeclaration', playerId: 'p2', outcome: 'real' }),
    );
    expect(next.phase).toBe('gameOver');
    expect(next.winnerId).toBe('p1');
  });

  it('is a draw when top scores are tied (no tie-break to a winner)', () => {
    const tied = makeState({
      players: [makePlayer('p1', [], 5), makePlayer('p2', [], 5)],
      drawPile: [],
      discardPile: [card('m1', 'Actor')],
    });

    // A player with more declared cards does NOT win a tie — it is a draw.
    const withDeclaredCards = expectOk(
      applyAction(
        { ...tied, declared: [combo({ playerId: 'p2' })] },
        { type: 'draw', playerId: 'p1', source: 'deck' },
      ),
    );
    expect(withDeclaredCards.phase).toBe('gameOver');
    expect(withDeclaredCards.winnerId).toBeUndefined();
    expect(withDeclaredCards.draw).toBe(true);

    // Same outcome with no declared cards.
    const withoutDeclaredCards = expectOk(
      applyAction(tied, { type: 'draw', playerId: 'p1', source: 'deck' }),
    );
    expect(withoutDeclaredCards.winnerId).toBeUndefined();
    expect(withoutDeclaredCards.draw).toBe(true);
  });
});

describe('hand refill after declaring', () => {
  it('restores the declaring player to a full hand from the draw pile', () => {
    const actor = card('m1', 'Actor');
    const actress = card('m1', 'Actress');
    const spare = card('m2', 'Genre');
    const drawCards = [
      card('d1', 'Actor'),
      card('d2', 'Actress'),
      card('d3', 'Genre'),
      card('d4', 'Setting'),
      card('d5', 'Period'),
      card('d6', 'ReleaseYear'),
      card('d7', 'Actor'),
    ];

    const state = makeState({
      phase: 'discard',
      drawPile: drawCards,
      players: [makePlayer('p1', [actor, actress, spare]), makePlayer('p2')],
    });

    const next = expectOk(
      applyAction(state, {
        type: 'declare',
        playerId: 'p1',
        cardIds: [actor.id, actress.id],
      }),
    );

    // Hand was 3, declared 2 → 1, then refilled to the full hand size of 7.
    expect(next.players[0].hand).toHaveLength(DEFAULT_HAND_SIZE);
    expect(next.players[0].hand).toContain(spare);
    expect(next.drawPile).toHaveLength(drawCards.length - (DEFAULT_HAND_SIZE - 1));
    const declaredIds = new Set([actor.id, actress.id]);
    expect(next.drawPile.every((card) => !declaredIds.has(card.id))).toBe(true);
  });

  it('does not shrink the hand below the full size when the deck runs out', () => {
    const actor = card('m1', 'Actor');
    const actress = card('m1', 'Actress');
    const spare = card('m2', 'Genre');
    const state = makeState({
      phase: 'discard',
      drawPile: [card('d1', 'Actor')],
      discardPile: [],
      players: [makePlayer('p1', [actor, actress, spare]), makePlayer('p2')],
    });

    const next = expectOk(
      applyAction(state, {
        type: 'declare',
        playerId: 'p1',
        cardIds: [actor.id, actress.id],
      }),
    );

    // Only one card is available to refill with, so the hand grows to 2, not 7.
    expect(next.players[0].hand).toHaveLength(2);
    expect(next.drawPile).toHaveLength(0);
  });
});
