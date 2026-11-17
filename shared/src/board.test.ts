import { describe, expect, it } from 'vitest';
import {
  BOARD_HAND_CAP,
  BOARD_SIZE,
  BOARD_SPACES,
  applyBoardAction,
  boardCardsRemaining,
  chooseBoardAiAction,
  createBoardGame,
  generateBoardSpaces,
  type BoardSpace,
  type BoardSpaceType,
  type BoardState,
} from './board';
import { FIXTURE_MOVIES } from './testFixtures';
import type { Card, Category } from './types';

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

function makePlayer(id: string, hand: Card[] = [], score = 0, kind: 'human' | 'ai' = 'human') {
  return { id, name: id.toUpperCase(), kind, hand, score, contestsUsed: 0 };
}

/** A fixed board layout where every space a single die roll can reach (indices
 * 1–6 from a start of 0) is a colour category, so a roll always draws. Used by
 * tests that only care about the draw/declare flow, not the space layout. */
function colourDrawSpaces(): BoardSpace[] {
  const spaces: BoardSpaceType[] = ['pass'];
  for (const category of ALL_CATEGORIES) spaces.push(category);
  for (const category of ALL_CATEGORIES) spaces.push(category);
  for (let i = 0; i < 3; i += 1) spaces.push('any');
  return spaces.map((type, index) => ({ index, type }));
}

/** Resolve the post-roll phase back to `declare` so the turn can continue:
 * pick a category on an "any" space, or close a solo exchange. */
function settleRoll(state: BoardState, playerId: string): BoardState {
  let current = state;
  if (current.phase === 'chooseAny') {
    const category = ALL_CATEGORIES.find((cat) => current.piles[cat].length > 0);
    if (!category) throw new Error('no category to choose');
    const chosen = applyBoardAction(current, {
      type: 'chooseAnyCategory',
      playerId,
      category,
    });
    if (!chosen.ok) throw new Error(chosen.error);
    current = chosen.state;
  }
  if (current.phase === 'exchange') {
    const hand = current.players.find((player) => player.id === playerId);
    if (!hand) throw new Error('missing player');
    const offer = applyBoardAction(current, {
      type: 'offerExchange',
      playerId,
      cardIds: hand.hand.slice(0, 2).map((card) => card.id),
    });
    if (!offer.ok) throw new Error(offer.error);
    current = offer.state;
  }
  return current;
}

/** Find a seed whose opening roll lands on an "any" space (opens the choice). */
function landOnAny(): BoardState {
  for (let seed = 1; seed < 500; seed += 1) {
    const base = createBoardGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed,
      players: [makePlayer('p1')],
    });
    const rolled = applyBoardAction(base, { type: 'roll', playerId: 'p1' });
    if (rolled.ok && rolled.state.phase === 'chooseAny') return rolled.state;
  }
  throw new Error('could not land on an "any" space');
}

describe('BOARD_SPACES', () => {
  it('has 16 spaces: 12 colour, 3 any, 1 pass', () => {
    expect(BOARD_SPACES).toHaveLength(BOARD_SIZE);
    const colours = BOARD_SPACES.filter((s) => s.type !== 'any' && s.type !== 'pass');
    const any = BOARD_SPACES.filter((s) => s.type === 'any');
    const pass = BOARD_SPACES.filter((s) => s.type === 'pass');
    expect(colours).toHaveLength(12);
    expect(any).toHaveLength(3);
    expect(pass).toHaveLength(1);
    expect(new Set(BOARD_SPACES.map((s) => s.index)).size).toBe(BOARD_SIZE);
  });
});

describe('createBoardGame', () => {
  it('sets up the board with all seats at the start and a roll phase', () => {
    const state = createBoardGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 1,
      players: [makePlayer('p1'), makePlayer('p2')],
    });
    expect(state.variant).toBe('board');
    expect(state.phase).toBe('roll');
    expect(state.positions).toEqual({ p1: 0, p2: 0 });
    expect(state.handCap).toBe(BOARD_HAND_CAP);
    expect(state.players).toHaveLength(2);
    // A supply of cards exists.
    expect(boardCardsRemaining(state)).toBeGreaterThan(0);
  });

  it('shuffles the board so no two neighbouring spaces share a type', () => {
    for (const seed of [1, 2, 7, 42, 99, 123]) {
      const state = createBoardGame(FIXTURE_MOVIES, {
        mode: 'find',
        seed,
        players: [makePlayer('p1'), makePlayer('p2')],
      });
      const types = state.spaces.map((s) => s.type);
      expect(types).toHaveLength(BOARD_SIZE);
      const colours = types.filter((t) => t !== 'any' && t !== 'pass');
      expect(colours).toHaveLength(12);
      expect(types.filter((t) => t === 'any')).toHaveLength(3);
      expect(types.filter((t) => t === 'pass')).toHaveLength(1);
      for (let i = 0; i < BOARD_SIZE; i += 1) {
        expect(types[i]).not.toBe(types[(i + 1) % BOARD_SIZE]);
      }
    }
  });
});

describe('rolling', () => {
  it('moves the token, draws when appropriate, and opens the declare phase', () => {
    const base = createBoardGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 3,
      players: [makePlayer('p1'), makePlayer('p2')],
    });
    const rolled = applyBoardAction(base, { type: 'roll', playerId: 'p1' });
    expect(rolled.ok).toBe(true);
    if (!rolled.ok) return;
    const state = rolled.state;
    // Rolling opens a turn: either the declare phase, the "any" category choice,
    // or (on a full hand) an exchange.
    expect(['declare', 'chooseAny', 'exchange']).toContain(state.phase);
    expect(state.lastRoll).toBeGreaterThanOrEqual(1);
    expect(state.lastRoll).toBeLessThanOrEqual(6);
    expect(state.positions.p1).toBe(state.landedSpace);
    expect(state.positions.p1).toBeGreaterThanOrEqual(0);
    expect(state.positions.p1).toBeLessThan(BOARD_SIZE);
  });

  it('is deterministic for a given seed', () => {
    const a = applyBoardAction(
      createBoardGame(FIXTURE_MOVIES, { mode: 'find', seed: 42, players: [makePlayer('p1')] }),
      { type: 'roll', playerId: 'p1' },
    );
    const b = applyBoardAction(
      createBoardGame(FIXTURE_MOVIES, { mode: 'find', seed: 42, players: [makePlayer('p1')] }),
      { type: 'roll', playerId: 'p1' },
    );
    if (a.ok && b.ok) {
      expect(a.state.lastRoll).toBe(b.state.lastRoll);
      expect(a.state.positions.p1).toBe(b.state.positions.p1);
    } else {
      throw new Error('rolls failed');
    }
  });

  it('pass spaces draw nothing; colour/any spaces draw into the hand', () => {
    let state = createBoardGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 7,
      players: [makePlayer('p1')],
    });
    let sawPass = false;
    let sawDraw = false;
    for (let turn = 0; turn < 60; turn += 1) {
      const before = state.players[0].hand.length;
      const rolled = applyBoardAction(state, { type: 'roll', playerId: 'p1' });
      expect(rolled.ok).toBe(true);
      if (!rolled.ok) break;
      state = rolled.state;
      // A full hand landing on a draw space opens an exchange; with a single
      // player it closes as soon as the offerer proposes (no one to trade with).
      if (state.phase === 'exchange') {
        const offer = applyBoardAction(state, {
          type: 'offerExchange',
          playerId: 'p1',
          cardIds: state.players[0].hand.slice(0, 2).map((card) => card.id),
        });
        expect(offer.ok).toBe(true);
        if (!offer.ok) break;
        state = offer.state;
      }
      // Landing on "any" lets the player pick a category; choose one to draw.
      if (state.phase === 'chooseAny') {
        const category = ALL_CATEGORIES.find((cat) => state.piles[cat].length > 0);
        if (!category) throw new Error('no category to choose');
        const chosen = applyBoardAction(state, {
          type: 'chooseAnyCategory',
          playerId: 'p1',
          category,
        });
        expect(chosen.ok).toBe(true);
        if (!chosen.ok) break;
        state = chosen.state;
      }
      const space = state.spaces[state.landedSpace ?? 0];
      const delta = state.players[0].hand.length - before;
      if (space.type === 'pass') {
        sawPass = true;
        expect(delta).toBe(0);
      } else if (delta === 1) {
        sawDraw = true;
      }
      const ended = applyBoardAction(state, { type: 'endTurn', playerId: 'p1' });
      if (!ended.ok) throw new Error(ended.error);
      state = ended.state;
      if (state.phase === 'gameOver') break;
    }
    expect(sawPass).toBe(true);
    expect(sawDraw).toBe(true);
  });

  it('respects the hand cap when drawing', () => {
    const base = createBoardGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 5,
      players: [makePlayer('p1')],
    });
    base.players[0].hand = Array.from({ length: BOARD_HAND_CAP }, (_, i) =>
      card('matrix', 'Genre', i),
    );
    const rolled = applyBoardAction(base, { type: 'roll', playerId: 'p1' });
    expect(rolled.ok).toBe(true);
    if (rolled.ok) expect(rolled.state.players[0].hand.length).toBe(BOARD_HAND_CAP);
  });

  it('a roll onto an "any" space opens the category choice', () => {
    const state = landOnAny();
    expect(state.phase).toBe('chooseAny');
    expect(state.landedSpace).toBeDefined();
    expect(state.spaces[state.landedSpace ?? 0].type).toBe('any');
  });

  it('lets the player choose a category on an "any" space and draws from it', () => {
    const state = landOnAny();
    const category = ALL_CATEGORIES.find((cat) => state.piles[cat].length > 0);
    if (!category) throw new Error('no category to draw');
    const before = state.players[0].hand.length;
    const chosen = applyBoardAction(state, {
      type: 'chooseAnyCategory',
      playerId: 'p1',
      category,
    });
    expect(chosen.ok).toBe(true);
    if (chosen.ok) {
      expect(chosen.state.phase).toBe('declare');
      expect(chosen.state.players[0].hand.length).toBe(before + 1);
      const drawn = chosen.state.players[0].hand[chosen.state.players[0].hand.length - 1];
      expect(drawn.category).toBe(category);
    }
  });

  it('rejects choosing an empty category on an "any" space', () => {
    const state = landOnAny();
    const target = ALL_CATEGORIES[0];
    state.piles[target] = [];
    const chosen = applyBoardAction(state, {
      type: 'chooseAnyCategory',
      playerId: 'p1',
      category: target,
    });
    expect(chosen.ok).toBe(false);
  });
});

describe('declaring on the board', () => {
  it('holds all points in a pending declaration for a human', () => {
    const base = createBoardGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 2,
      players: [makePlayer('p1')],
    });
    base.spaces = colourDrawSpaces();
    base.players[0].hand = [card('matrix', 'Actor'), card('matrix', 'Actress')];
    const rolled = applyBoardAction(base, { type: 'roll', playerId: 'p1' });
    if (!rolled.ok) throw new Error('roll failed');
    const state = rolled.state;

    const human = applyBoardAction(state, {
      type: 'declare',
      playerId: 'p1',
      cardIds: ['matrix:Actor:0', 'matrix:Actress:0'],
      claimedTitle: 'The Matrix',
    });
    expect(human.ok).toBe(true);
    if (human.ok) {
      expect(human.state.players[0].score).toBe(0); // held, not yet scored
      expect(human.state.pendingDeclaration?.basePoints).toBe(4);
      expect(human.state.pendingDeclaration?.bonusPoints).toBe(10);
      expect(human.state.declared).toHaveLength(0);
      // The two declared cards are spent; only the card drawn by the roll remains.
      expect(human.state.players[0].hand).toHaveLength(1);
      expect(human.state.players[0].hand.every((c) => c.movieId !== 'matrix')).toBe(true);
    }
  });

  it('awards the bonus on verification and auto-verifies AI', () => {
    const humanBase = createBoardGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 2,
      players: [makePlayer('p1')],
    });
    humanBase.spaces = colourDrawSpaces();
    humanBase.players[0].hand = [card('matrix', 'Actor'), card('matrix', 'Actress')];
    const rolled = applyBoardAction(humanBase, { type: 'roll', playerId: 'p1' });
    if (!rolled.ok) throw new Error('roll failed');
    const human = applyBoardAction(rolled.state, {
      type: 'declare',
      playerId: 'p1',
      cardIds: ['matrix:Actor:0', 'matrix:Actress:0'],
      claimedTitle: 'The Matrix',
    });
    if (!human.ok) throw new Error('declare failed');
    const verified = applyBoardAction(human.state, {
      type: 'resolveDeclaration',
      playerId: 'p1',
      outcome: 'real',
    });
    if (!verified.ok) throw new Error(verified.error);
    expect(verified.state.players[0].score).toBe(14); // 4 base + 10 bonus
    expect(verified.state.declared[0]?.verified).toBe(true);

    const aiBase = createBoardGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 2,
      players: [makePlayer('p1', [], 0, 'ai')],
    });
    aiBase.spaces = colourDrawSpaces();
    aiBase.players[0].hand = [card('matrix', 'Actor'), card('matrix', 'Actress')];
    const aiRolled = applyBoardAction(aiBase, { type: 'roll', playerId: 'p1' });
    if (!aiRolled.ok) throw new Error('roll failed');
    const ai = applyBoardAction(aiRolled.state, {
      type: 'declare',
      playerId: 'p1',
      cardIds: ['matrix:Actor:0', 'matrix:Actress:0'],
    });
    expect(ai.ok).toBe(true);
    if (ai.ok) {
      expect(ai.state.players[0].score).toBe(14); // 4 base + 10 bonus
      expect(ai.state.declared[0]?.verified).toBe(true);
    }
  });

  it('penalises a fake claim and a wrong contest on the board', () => {
    const base = createBoardGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 2,
      players: [makePlayer('p1'), makePlayer('p2')],
    });
    base.spaces = colourDrawSpaces();
    base.players[0].hand = [card('m1', 'Actor'), card('m1', 'Actress')];
    const rolled = applyBoardAction(base, { type: 'roll', playerId: 'p1' });
    if (!rolled.ok) throw new Error('roll failed');
    const declared = applyBoardAction(rolled.state, {
      type: 'declare',
      playerId: 'p1',
      cardIds: ['m1:Actor:0', 'm1:Actress:0'],
      claimedTitle: 'Made Up',
    });
    if (!declared.ok) throw new Error(declared.error);
    const contested = applyBoardAction(declared.state, {
      type: 'contest',
      playerId: 'p2',
      declarationId: 'pending-1',
    });
    if (!contested.ok) throw new Error(contested.error);
    const resolved = applyBoardAction(contested.state, {
      type: 'resolveDeclaration',
      playerId: 'p2',
      outcome: 'real', // p2 contested a real claim → wrong contest
    });
    if (!resolved.ok) throw new Error(resolved.error);
    expect(resolved.state.players[0].score).toBe(14); // declarer awarded (4 base + 10 bonus)
    expect(resolved.state.players[1].score).toBe(-5); // wrong contest penalty
  });

  it('rejects declaring before rolling', () => {
    const base = createBoardGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 2,
      players: [makePlayer('p1')],
    });
    const result = applyBoardAction(base, {
      type: 'declare',
      playerId: 'p1',
      cardIds: ['matrix:Actor:0', 'matrix:Actress:0'],
    });
    expect(result.ok).toBe(false);
  });

  it('rejects ending the turn while a declaration is pending', () => {
    const base = createBoardGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 2,
      players: [makePlayer('p1')],
    });
    base.spaces = colourDrawSpaces();
    base.players[0].hand = [card('matrix', 'Actor'), card('matrix', 'Actress')];
    const rolled = applyBoardAction(base, { type: 'roll', playerId: 'p1' });
    if (!rolled.ok) throw new Error('roll failed');
    const declared = applyBoardAction(rolled.state, {
      type: 'declare',
      playerId: 'p1',
      cardIds: ['matrix:Actor:0', 'matrix:Actress:0'],
      claimedTitle: 'The Matrix',
    });
    if (!declared.ok) throw new Error('declare failed');
    const ended = applyBoardAction(declared.state, { type: 'endTurn', playerId: 'p1' });
    expect(ended.ok).toBe(false);
  });
});

describe('turn and round flow', () => {
  it('advances to the next player and increments the round on a lap', () => {
    const base = createBoardGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 1,
      players: [makePlayer('p1'), makePlayer('p2')],
    });
    let state = base;
    const r1 = applyBoardAction(state, { type: 'roll', playerId: 'p1' });
    if (!r1.ok) throw new Error(r1.error);
    state = settleRoll(r1.state, 'p1');
    const e1 = applyBoardAction(state, { type: 'endTurn', playerId: 'p1' });
    if (!e1.ok) throw new Error(e1.error);
    state = e1.state;
    expect(state.currentPlayerIndex).toBe(1);
    expect(state.round).toBe(1);

    const r2 = applyBoardAction(state, { type: 'roll', playerId: 'p2' });
    if (!r2.ok) throw new Error(r2.error);
    state = settleRoll(r2.state, 'p2');
    const e2 = applyBoardAction(state, { type: 'endTurn', playerId: 'p2' });
    if (!e2.ok) throw new Error(e2.error);
    state = e2.state;
    expect(state.currentPlayerIndex).toBe(0);
    expect(state.round).toBe(2);
  });

  it('wins by target score', () => {
    const base = createBoardGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 2,
      targetScore: 10,
      players: [makePlayer('p1', [], 9, 'ai')],
    });
    base.spaces = colourDrawSpaces();
    base.players[0].hand = [card('matrix', 'Actor'), card('matrix', 'Actress')];
    const rolled = applyBoardAction(base, { type: 'roll', playerId: 'p1' });
    const state = (rolled as { state: BoardState }).state;
    const declared = applyBoardAction(state, {
      type: 'declare',
      playerId: 'p1',
      cardIds: ['matrix:Actor:0', 'matrix:Actress:0'],
    });
    expect(declared.ok).toBe(true);
    if (declared.ok) {
      expect(declared.state.phase).toBe('gameOver');
      expect(declared.state.winnerId).toBe('p1');
    }
  });

  it('ends after the round limit with the highest scorer winning', () => {
    const base = createBoardGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 1,
      maxRounds: 2,
      players: [makePlayer('p1'), makePlayer('p2')],
    });
    // `createBoardGame` resets scores to 0, so set them after creation.
    base.players[0].score = 50;
    base.players[1].score = 30;
    base.round = 2;
    base.phase = 'declare';
    base.currentPlayerIndex = 1; // p2 ends the final round
    const result = applyBoardAction(base, { type: 'endTurn', playerId: 'p2' });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.state.phase).toBe('gameOver');
      expect(result.state.winnerId).toBe('p1');
      expect(result.state.draw).toBe(false);
    }
  });
});

describe('board AI', () => {
  it('rolls on its turn and ends or declares in the declare phase', () => {
    const base = createBoardGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 1,
      players: [makePlayer('p1', [], 0, 'ai')],
    });
    expect(chooseBoardAiAction(base)).toEqual({ type: 'roll', playerId: 'p1' });

    const rolled = applyBoardAction(base, { type: 'roll', playerId: 'p1' });
    const state = (rolled as { state: BoardState }).state;
    const action = chooseBoardAiAction(state);
    expect(action?.type === 'declare' || action?.type === 'endTurn').toBe(true);
  });
});

describe('full-hand exchange', () => {
  /** Open an exchange by rolling at the hand cap (searching seeds for a draw). */
  function openExchange(): BoardState {
    for (let seed = 1; seed < 400; seed += 1) {
      const base = createBoardGame(FIXTURE_MOVIES, {
        mode: 'find',
        seed,
        players: [makePlayer('p1'), makePlayer('p2')],
      });
      base.players[0].hand = Array.from({ length: BOARD_HAND_CAP }, (_, i) =>
        card('matrix', 'Genre', i),
      );
      base.players[1].hand = [card('titanic', 'Actor'), card('titanic', 'Actress')];
      const rolled = applyBoardAction(base, { type: 'roll', playerId: 'p1' });
      if (rolled.ok && rolled.state.phase === 'exchange') return rolled.state;
    }
    throw new Error('could not open an exchange in the seed range');
  }

  it('opens an exchange instead of skipping the draw when the hand is full', () => {
    const state = openExchange();
    expect(state.phase).toBe('exchange');
    expect(state.exchange?.offererId).toBe('p1');
    expect(state.exchange?.order).toEqual(['p2']);
    expect(state.players[0].hand).toHaveLength(BOARD_HAND_CAP);
  });

  it('rejects an offer that is empty or longer than two cards', () => {
    const state = openExchange();
    const none = applyBoardAction(state, {
      type: 'offerExchange',
      playerId: 'p1',
      cardIds: [],
    });
    expect(none.ok).toBe(false);
    const three = applyBoardAction(state, {
      type: 'offerExchange',
      playerId: 'p1',
      cardIds: state.players[0].hand.slice(0, 3).map((c) => c.id),
    });
    expect(three.ok).toBe(false);
  });

  it('only the offerer may propose and only once', () => {
    const state = openExchange();
    const byOther = applyBoardAction(state, {
      type: 'offerExchange',
      playerId: 'p2',
      cardIds: ['matrix:Genre:0'],
    });
    expect(byOther.ok).toBe(false);
    const once = applyBoardAction(state, {
      type: 'offerExchange',
      playerId: 'p1',
      cardIds: ['matrix:Genre:0'],
    });
    expect(once.ok).toBe(true);
    if (!once.ok) return;
    const twice = applyBoardAction(once.state, {
      type: 'offerExchange',
      playerId: 'p1',
      cardIds: ['matrix:Genre:1'],
    });
    expect(twice.ok).toBe(false);
  });

  it('a responder can swap one card, after which the exchange closes', () => {
    const state = openExchange();
    const offered = applyBoardAction(state, {
      type: 'offerExchange',
      playerId: 'p1',
      cardIds: ['matrix:Genre:0'],
    });
    expect(offered.ok).toBe(true);
    if (!offered.ok) return;
    const accepted = applyBoardAction(offered.state, {
      type: 'respondExchange',
      playerId: 'p2',
      accept: true,
      giveCardId: 'titanic:Actor:0',
      takeCardId: 'matrix:Genre:0',
    });
    expect(accepted.ok).toBe(true);
    if (!accepted.ok) return;
    const s = accepted.state;
    expect(s.phase).toBe('declare'); // p2 was the only responder → closes
    expect(s.exchange).toBeUndefined();
    expect(s.players[0].hand.map((c) => c.id)).toContain('titanic:Actor:0');
    expect(s.players[0].hand.map((c) => c.id)).not.toContain('matrix:Genre:0');
    expect(s.players[1].hand.map((c) => c.id)).toContain('matrix:Genre:0');
    expect(s.players[1].hand.map((c) => c.id)).not.toContain('titanic:Actor:0');
    expect(s.players[0].hand).toHaveLength(BOARD_HAND_CAP); // even swap keeps the cap
  });

  it('a decline passes to the next player and closes after the round', () => {
    const state = openExchange();
    const offered = applyBoardAction(state, {
      type: 'offerExchange',
      playerId: 'p1',
      cardIds: ['matrix:Genre:0'],
    });
    if (!offered.ok) return;
    const declined = applyBoardAction(offered.state, {
      type: 'respondExchange',
      playerId: 'p2',
      accept: false,
    });
    expect(declined.ok).toBe(true);
    if (!declined.ok) return;
    expect(declined.state.phase).toBe('declare');
    expect(declined.state.exchange).toBeUndefined();
    // Declining must not move any cards.
    expect(declined.state.players[0].hand.map((c) => c.id)).not.toContain('titanic:Actor:0');
  });

  it('only the current responder may answer, and not before the offer', () => {
    const state = openExchange();
    const early = applyBoardAction(state, {
      type: 'respondExchange',
      playerId: 'p2',
      accept: false,
    });
    expect(early.ok).toBe(false);
  });

  it('an AI offerer proposes one or two cards automatically', () => {
    for (let seed = 1; seed < 400; seed += 1) {
      const base = createBoardGame(FIXTURE_MOVIES, {
        mode: 'find',
        seed,
        players: [makePlayer('p1', [], 0, 'ai'), makePlayer('p2')],
      });
      base.players[0].hand = Array.from({ length: BOARD_HAND_CAP }, (_, i) =>
        card('matrix', 'Genre', i),
      );
      base.players[1].hand = [card('titanic', 'Actor'), card('titanic', 'Actress')];
      const rolled = applyBoardAction(base, { type: 'roll', playerId: 'p1' });
      if (!rolled.ok || rolled.state.phase !== 'exchange') continue;
      const action = chooseBoardAiAction(rolled.state);
      expect(action?.type).toBe('offerExchange');
      if (action?.type === 'offerExchange') {
        expect(action.cardIds.length).toBeGreaterThanOrEqual(1);
        expect(action.cardIds.length).toBeLessThanOrEqual(2);
      }
      break;
    }
  });
});

describe('round-limit end (no scoreless win)', () => {
  /** Drive a game past the round limit with the given scores and check the outcome. */
  function endAtRoundLimit(scores: number[]): BoardState {
    const last = scores.length - 1;
    const base = createBoardGame(FIXTURE_MOVIES, {
      mode: 'find',
      seed: 1,
      players: scores.map((_, i) => makePlayer(`p${i + 1}`)),
    });
    // `createBoardGame` always resets scores to 0, so set them afterwards.
    scores.forEach((score, i) => {
      base.players[i].score = score;
    });
    base.round = base.maxRounds;
    base.currentPlayerIndex = last; // ending the last seat wraps to 0 and advances the round
    base.phase = 'declare';
    const result = applyBoardAction(base, { type: 'endTurn', playerId: `p${last + 1}` });
    if (!result.ok) throw new Error(result.error);
    return result.state;
  }

  it('is a draw when nobody scored', () => {
    const state = endAtRoundLimit([0, 0, 0]);
    expect(state.phase).toBe('gameOver');
    expect(state.winnerId).toBeUndefined();
    expect(state.draw).toBe(true);
  });

  it('is a draw when the top score is tied', () => {
    const state = endAtRoundLimit([10, 10, 4]);
    expect(state.phase).toBe('gameOver');
    expect(state.winnerId).toBeUndefined();
    expect(state.draw).toBe(true);
  });

  it('names a single leader at the round limit', () => {
    const state = endAtRoundLimit([12, 5, 5]);
    expect(state.phase).toBe('gameOver');
    expect(state.winnerId).toBe('p1');
    expect(state.draw).toBe(false);
  });

  it('still crowns a player who reached the target mid-game', () => {
    const state = endAtRoundLimit([100, 3, 0]);
    expect(state.phase).toBe('gameOver');
    expect(state.winnerId).toBe('p1');
    expect(state.draw).toBe(false);
  });
});
