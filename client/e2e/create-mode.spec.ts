import { expect, test, type Page } from '@playwright/test';

/**
 * Create-a-Movie end-to-end coverage.
 *
 * Create is a human-only, social variant: there is no scoring and no quiz timer.
 * 2–3 players pitch freely (no winner); 4–6 players vote and the first pitch to
 * earn 3 👍 wins. These specs drive the real naming + voting overlays and assert
 * the engine state afterwards.
 */

interface DevCard {
  id: string;
  category: string;
  label: string;
}

interface DevPlayer {
  id: string;
  kind: 'human' | 'ai';
  name: string;
  hand: DevCard[];
}

interface DevPending {
  id: string;
  playerId: string;
  mode?: string;
  claimedTitle?: string;
  claimedSynopsis?: string;
  votes?: Record<string, 'up' | 'down'>;
}

interface DevDeclared {
  playerId: string;
  claimedTitle?: string;
  claimedSynopsis?: string;
  verified: boolean;
  mode?: string;
}

interface DevState {
  mode: string;
  phase: string;
  winnerId: string | null;
  currentPlayerIndex: number;
  pendingDeclaration: DevPending | null;
  declared: DevDeclared[];
  players: DevPlayer[];
}

interface DevHook {
  store: { dispatch(action: unknown): { ok: boolean; error?: string } };
  state: DevState;
  selectCard(cardId: string): void;
}

async function startCreate(page: Page, playerCount: number): Promise<void> {
  await page.goto('/');
  // Selecting Create forces hotseat (vs AI is disabled for this mode).
  await page.getByRole('button', { name: /Create a Movie/i }).click();
  await page.getByRole('button', { name: String(playerCount), exact: true }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.getByRole('button', { name: 'Draw from deck' }).click();
  // Create mode labels the action "Pitch movie" (Find mode says "Declare movie").
  await page.getByRole('button', { name: 'Pitch movie' }).waitFor();
}

/** Submit a valid 2-card / 2-category pitch through the dev hook. */
async function declareViaHook(
  page: Page,
  title: string,
  synopsis: string,
): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate(
    ({ claimedTitle, claimedSynopsis }) => {
      const hook = (window as unknown as { __movieGame?: DevHook }).__movieGame;
      if (!hook) throw new Error('window.__movieGame dev hook is missing');
      const state = hook.state;
      const declarer = state.players[state.currentPlayerIndex];
      let fallback: [string, string] | null = null;
      for (let i = 0; i < declarer.hand.length; i += 1) {
        for (let j = i + 1; j < declarer.hand.length; j += 1) {
          if (declarer.hand[i].category !== declarer.hand[j].category) {
            if (!fallback) fallback = [declarer.hand[i].id, declarer.hand[j].id];
            return hook.store.dispatch({
              type: 'declare',
              playerId: declarer.id,
              cardIds: [declarer.hand[i].id, declarer.hand[j].id],
              claimedTitle,
              claimedSynopsis,
            });
          }
        }
      }
      if (fallback) {
        return hook.store.dispatch({
          type: 'declare',
          playerId: declarer.id,
          cardIds: fallback,
          claimedTitle,
          claimedSynopsis,
        });
      }
      return { ok: false, error: 'no 2-category pair in hand' };
    },
    { claimedTitle: title, claimedSynopsis: synopsis },
  );
}

async function snapshot(page: Page): Promise<DevState> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __movieGame?: DevHook }).__movieGame;
    if (!hook) throw new Error('window.__movieGame dev hook is missing');
    const state = hook.state;
    return {
      mode: state.mode,
      phase: state.phase,
      winnerId: state.winnerId ?? null,
      currentPlayerIndex: state.currentPlayerIndex,
      pendingDeclaration: state.pendingDeclaration ?? null,
      declared: state.declared,
      players: state.players,
    };
  });
}

test('vs AI is disabled for Create a Movie', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /Create a Movie/i }).click();

  const vsAi = page.getByRole('button', { name: 'vs AI' });
  await expect(vsAi).toBeDisabled();
  // Hotseat is forced on and selected.
  const hotseat = page.getByRole('button', { name: 'Hotseat' });
  await expect(hotseat).toHaveClass(/is-selected/);
});

test('the naming overlay collects a title + synopsis with no timer', async ({ page }) => {
  await startCreate(page, 2);

  // Select a valid 2-category pair through the real selection path.
  const selected = await page.evaluate(() => {
    const hook = (window as unknown as { __movieGame?: DevHook }).__movieGame;
    if (!hook) throw new Error('window.__movieGame dev hook is missing');
    const hand = hook.state.players[hook.state.currentPlayerIndex].hand;
    const seen = new Map<string, string>();
    for (const card of hand) {
      if (!seen.has(card.category)) seen.set(card.category, card.id);
      if (seen.size === 2) break;
    }
    const ids = [...seen.values()];
    ids.forEach((id) => hook.selectCard(id));
    return ids;
  });
  expect(selected.length).toBe(2);

  await page.getByRole('button', { name: 'Pitch movie' }).click();

  // The pitch overlay shows a title input, a synopsis textarea and NO timer.
  const titleInput = page.locator('.claim-input').first();
  await expect(titleInput).toBeVisible();
  await expect(page.locator('.claim-textarea')).toBeVisible();
  await expect(page.locator('.trivia-timer')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /pitch it/i })).toBeVisible();

  await titleInput.fill('The Last Lighthouse');
  await page.locator('.claim-textarea').fill('A keeper haunted by the ships he never saved.');
  await page.getByRole('button', { name: /pitch it/i }).click();

  // 2 players = freeform: the pitch is recorded with no winner.
  const after = await snapshot(page);
  expect(after.phase).not.toBe('gameOver');
  expect(after.winnerId).toBeNull();
  expect(after.pendingDeclaration).toBeNull();
  expect(after.declared).toEqual([
    expect.objectContaining({
      claimedTitle: 'The Last Lighthouse',
      claimedSynopsis: 'A keeper haunted by the ships he never saved.',
      verified: true,
      mode: 'create',
    }),
  ]);

  const combo = page.locator('.combo-card').first();
  await expect(combo).toContainText('The Last Lighthouse');
  await expect(combo).toContainText('A keeper haunted by the ships he never saved.');
  await expect(combo).toContainText('👍 Passed');
  // The HUD shows pitch counts instead of a score for Create mode.
  await expect(page.locator('.player-chip').first()).toContainText('1 pitches');
});

test('a 4-player pitch wins on three thumbs up', async ({ page }) => {
  await startCreate(page, 4);
  const declareResult = await declareViaHook(
    page,
    'Midnight Cartography',
    'Two strangers redraw a city that keeps moving.',
  );
  expect(declareResult.ok, declareResult.error).toBe(true);

  const afterDeclare = await snapshot(page);
  expect(afterDeclare.pendingDeclaration?.mode).toBe('create');
  expect(afterDeclare.pendingDeclaration?.votes).toEqual({});

  // The voting overlay shows the pitch and the running tally.
  const pitch = page.locator('.claim-pitch');
  await expect(pitch).toBeVisible();
  await expect(pitch).toContainText('Midnight Cartography');
  await expect(pitch).toContainText('Two strangers redraw a city that keeps moving.');
  await expect(page.locator('.trivia-timer--votes')).toContainText('👍 0/3');

  // Player 2 is already the acting seat (turn advanced to them on declare).
  await page.getByRole('button', { name: /👍 Thumbs up/i }).click();
  await expect(page.locator('.trivia-timer--votes')).toContainText('👍 1/3');

  // Pass the device to Player 3, then Player 4, each thumbs up.
  await page.getByRole('button', { name: 'Player 3', exact: true }).click();
  await page.getByRole('button', { name: /👍 Thumbs up/i }).click();
  await expect(page.locator('.trivia-timer--votes')).toContainText('👍 2/3');

  await page.getByRole('button', { name: 'Player 4', exact: true }).click();
  await page.getByRole('button', { name: /👍 Thumbs up/i }).click();

  // Three 👍 → game over, and Results shows the winning pitch.
  const afterWin = await snapshot(page);
  expect(afterWin.phase).toBe('gameOver');
  expect(afterWin.winnerId).toBe(afterDeclare.pendingDeclaration?.playerId ?? null);

  const highlight = page.locator('.results__highlight');
  await expect(highlight).toBeVisible();
  await expect(highlight).toContainText('Winning pitch');
  await expect(highlight).toContainText('Midnight Cartography');
  await expect(highlight).toContainText('Two strangers redraw a city that keeps moving.');
});

test('a pitch that fails the vote is logged not passed and the game continues', async ({ page }) => {
  await startCreate(page, 4);
  const declareResult = await declareViaHook(page, 'Gravity’s Anthem', 'A choir that sings satellites awake.');
  expect(declareResult.ok, declareResult.error).toBe(true);

  // Every non-declarer thumbs down: all voted, fewer than 3 👍 → pitch fails.
  await page.getByRole('button', { name: /👎 Thumbs down/i }).click();
  await page.getByRole('button', { name: 'Player 3', exact: true }).click();
  await page.getByRole('button', { name: /👎 Thumbs down/i }).click();
  await page.getByRole('button', { name: 'Player 4', exact: true }).click();
  await page.getByRole('button', { name: /👎 Thumbs down/i }).click();

  const after = await snapshot(page);
  expect(after.phase).not.toBe('gameOver');
  expect(after.winnerId).toBeNull();
  expect(after.pendingDeclaration).toBeNull();
  expect(after.declared[0]?.verified).toBe(false);

  const combo = page.locator('.combo-card').first();
  await expect(combo).toContainText('Gravity’s Anthem');
  await expect(combo).toContainText('👎 Not passed');
});
