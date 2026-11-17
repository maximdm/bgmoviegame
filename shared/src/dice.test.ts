import { describe, expect, it } from 'vitest';
import {
  DICE_HAND_CAP,
  applyDiceAction,
  chooseDiceAiAction,
  createDiceGame,
  diceCardsRemaining,
  type DiceState,
} from './dice';
import { FIXTURE_MOVIES } from './testFixtures';
import { CATEGORIES, type Card, type Category } from './types';

const ALL_CATEGORIES: readonly Category[] = [
  'Actor',
  'Actress',
  'Period',
  'Setting',
  'ReleaseYear',
  'Genre',
];

function card(movieId: string, category: Card['category'], index = 0): Card {
  return { id: `${movieId}:${category}:${index}`, category, label: `${movieId} ${category}`, movieId };
}

function makePlayer(
  id: string,
  hand: Card[] = [],
  score = 0,
  kind: 'human' | 'ai' = 'human',
) {
  return { id, name: id.toUpperCase(), kind, hand, score, contestsUsed: 0 };
}

/** A two-seat game with one card seeded into each category pile so any roll
 * draws something deterministically. */
function seededState(): DiceState {
  const state = createDiceGame(FIXTURE_MOVIES, {
    mode: 'find',
    seed: 1,
    players: [makePlayer('p1'), makePlayer('p2')],
  });
  for (const category of ALL_CATEGORIES) {
    state.piles[category] = [card(`${category}-movie`, category)];
  }
  return state;
}

describe('createDiceGame', () => {
  it('sets up the dice game at the roll phase with a hand cap and supply', () => {
    const state = createDiceGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 1,
      players: [makePlayer('p1'), makePlayer('p2')],
    });
    expect(state.variant).toBe('dice');
    expect(state.phase).toBe('roll');
    expect(state.handCap).toBe(DICE_HAND_CAP);
    expect(state.players).toHaveLength(2);
    expect(diceCardsRemaining(state)).toBeGreaterThan(0);
  });

  it('is deterministic for a given seed', () => {
    const a = applyDiceAction(
      createDiceGame(FIXTURE_MOVIES, { mode: 'find', seed: 42, players: [makePlayer('p1')] }),
      { type: 'roll', playerId: 'p1' },
    );
    const b = applyDiceAction(
      createDiceGame(FIXTURE_MOVIES, { mode: 'find', seed: 42, players: [makePlayer('p1')] }),
      { type: 'roll', playerId: 'p1' },
    );
    if (a.ok && b.ok) {
      expect(a.state.lastRoll).toBe(b.state.lastRoll);
      expect(a.state.rolledCategory).toBe(b.state.rolledCategory);
    } else {
      throw new Error('rolls failed');
    }
  });
});

describe('rolling', () => {
  it('draws from the rolled category and records it', () => {
    const state = seededState();
    const rolled = applyDiceAction(state, { type: 'roll', playerId: 'p1' });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    const after = rolled.state;
    expect(after.phase).toBe('declare');
    // The die value maps straight to a category (1 = Actor … 6 = Genre).
    expect(after.rolledCategory).toBe(CATEGORIES[(after.lastRoll ?? 1) - 1]);
    // A card of the rolled category was drawn into the hand.
    expect(after.players[0].hand.map((card) => card.category)).toContain(
      after.rolledCategory,
    );
  });

  it('skips the draw but keeps the turn when the rolled category is empty', () => {
    // Leave exactly one non-empty pile; every other roll (on an empty category)
    // must skip the draw yet still move to the declare phase.
    const base = seededState();
    for (const cat of ALL_CATEGORIES) {
      base.piles[cat] = cat === 'Genre' ? [card('g', 'Genre')] : [];
    }
    let state = base;
    let sawSkip = false;
    for (let i = 0; i < 40; i += 1) {
      const before = state.players[0].hand.length;
      const rolled = applyDiceAction(state, { type: 'roll', playerId: 'p1' });
      expect(rolled.ok).toBe(true);
      if (!rolled.ok) break;
      state = rolled.state;
      expect(state.phase).toBe('declare');
      const rolledCategory = state.rolledCategory;
      const pileEmpty = rolledCategory ? state.piles[rolledCategory].length === 0 : false;
      if (pileEmpty) {
        // No card drawn, turn kept.
        expect(state.players[0].hand.length).toBe(before);
        sawSkip = true;
        break;
      }
      const ended = applyDiceAction(state, { type: 'endTurn', playerId: 'p1' });
      if (!ended.ok) break;
      state = ended.state;
    }
    expect(sawSkip).toBe(true);
  });

  it('opens an exchange when a full-handed player rolls a drawable category', () => {
    const base = seededState();
    base.players[0].hand = Array.from({ length: DICE_HAND_CAP }, (_, i) => card('h', 'Genre', i));
    // Every category still has a card, so whatever the die lands on is drawable
    // and (with a full hand) opens an exchange rather than drawing.
    const rolled = applyDiceAction(base, { type: 'roll', playerId: 'p1' });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect(rolled.state.phase).toBe('exchange');
    expect(rolled.state.exchange?.offererId).toBe('p1');
  });
});

describe('declare / contest / win', () => {
  it('declares a combo, holds it pending, then resolves to score', () => {
    const base = seededState();
    base.players[0].hand = [
      card('matrix', 'Actor'),
      card('matrix', 'Actress'),
      card('matrix', 'Genre'),
    ];
    const rolled = applyDiceAction(base, { type: 'roll', playerId: 'p1' });
    if (!rolled.ok) throw new Error(rolled.error);
    const afterRoll = rolled.state;
    const declared = applyDiceAction(afterRoll, {
      type: 'declare',
      playerId: 'p1',
      cardIds: afterRoll.players[0].hand.map((c) => c.id),
      claimedTitle: 'The Matrix',
    });
    expect(declared.ok).toBe(true);
    if (!declared.ok) return;
    const pending = declared.state.pendingDeclaration;
    expect(pending).toBeDefined();
    expect(pending?.playerId).toBe('p1');
    expect(declared.state.players[0].hand).toHaveLength(0);
    const resolved = applyDiceAction(declared.state, {
      type: 'resolveDeclaration',
      playerId: 'p1',
      outcome: 'real',
    });
    expect(resolved.ok).toBe(true);
    if (!resolved.ok) return;
    expect(resolved.state.players[0].score).toBeGreaterThan(0);
    expect(resolved.state.declared).toHaveLength(1);
  });

  it('ends at the round limit as a draw when scores are tied', () => {
    const state = createDiceGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 1,
      maxRounds: 1,
      players: [makePlayer('p1'), makePlayer('p2')],
    });
    // Past the round limit with no outright leader: checkWin ends the game as a
    // draw the moment an action runs (here, the opening roll).
    state.round = 2;
    expect(state.round).toBeGreaterThan(state.maxRounds);
    const rolled = applyDiceAction(state, { type: 'roll', playerId: 'p1' });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    expect(rolled.state.phase).toBe('gameOver');
    expect(rolled.state.draw).toBe(true);
    expect(rolled.state.winnerId).toBeUndefined();
  });
});

describe('dice AI', () => {
  it('rolls on its turn and eventually declares or ends', () => {
    let state = createDiceGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 5,
      maxRounds: 12,
      players: [makePlayer('p1', [], 0, 'ai'), makePlayer('p2', [], 0, 'ai')],
    });
    // Drive AI-vs-AI turns; expect the game to reach a natural conclusion
    // (round limit) without crashing.
    for (let step = 0; step < 600; step += 1) {
      if (state.phase === 'gameOver') break;
      const action = chooseDiceAiAction(state);
      if (!action) break;
      const result = applyDiceAction(state, action);
      expect(result.ok).toBe(true);
      if (!result.ok) break;
      state = result.state;
    }
    expect(state.phase).toBe('gameOver');
    expect(state.players[0]).toBeDefined();
  });
});
