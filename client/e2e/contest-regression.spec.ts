import { expect, test, type Page } from '@playwright/test';

/**
 * Regression coverage for the contested-claim bug.
 *
 * Root cause: `finish()` in ClaimMovie closed over `pending`, but the countdown
 * effect's deps excluded the contest list. When a contest was raised after the
 * interval was scheduled, the effect did NOT re-run, so the still-running
 * interval invoked the STALE `finish` that saw `contests.length === 0` and
 * auto-awarded the claim as 'real' despite the contest.
 *
 * Test 1 reproduces the exact stale-closure scenario: the contest is added
 * through the engine (not the UI button), so `showResolution` stays false and
 * the original interval keeps running — the precise path that used to
 * auto-award. With the fix, `finish` reads `pendingRef.current` and only opens
 * the ruling panel (never auto-awards a contested claim).
 *
 * Test 2 exercises the UI: contesting through the button opens the ruling panel
 * at once, with no need to wait for a countdown.
 */

interface DevCard {
  id: string;
  category: string;
  label: string;
}

interface DevPlayer {
  id: string;
  kind: 'human' | 'ai';
  score: number;
  hand: DevCard[];
  name?: string;
}

interface DevPending {
  id: string;
  playerId: string;
  claimedTitle?: string;
  contests: unknown[];
}

interface DevState {
  players: DevPlayer[];
  currentPlayerIndex: number;
  pendingDeclaration: DevPending | null;
  declared: { claimedTitle?: string; verified: boolean; points: number }[];
}

interface DevHook {
  state: DevState;
  store: { dispatch(action: unknown): { ok: boolean; error?: string } };
}

async function startHotseat(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Hotseat' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.getByRole('button', { name: 'Draw from deck' }).click();
  await page.getByRole('button', { name: 'Declare movie' }).waitFor();
}

async function declare(page: Page, title: string): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate((claimedTitle) => {
    const hook = (window as unknown as { __movieGame?: DevHook }).__movieGame;
    if (!hook) throw new Error('window.__movieGame dev hook is missing (is this the dev server?)');
    const state = hook.state;
    const declarer = state.players[state.currentPlayerIndex];
    const isCast = (card: DevCard): boolean => card.category === 'Actor' || card.category === 'Actress';
    let fallback: [string, string] | null = null;
    for (let i = 0; i < declarer.hand.length; i += 1) {
      for (let j = i + 1; j < declarer.hand.length; j += 1) {
        if (declarer.hand[i].category !== declarer.hand[j].category) {
          if (!fallback) fallback = [declarer.hand[i].id, declarer.hand[j].id];
          if (isCast(declarer.hand[i]) || isCast(declarer.hand[j])) {
            return hook.store.dispatch({
              type: 'declare',
              playerId: declarer.id,
              cardIds: [declarer.hand[i].id, declarer.hand[j].id],
              claimedTitle,
            });
          }
        }
      }
    }
    if (fallback) {
      return hook.store.dispatch({
        type: 'declare',
        playerId: declarer.id,
        cardIds: fallback,
        claimedTitle,
      });
    }
    return { ok: false, error: 'no 2-category pair in hand' };
  }, title);
}

async function contestViaEngine(page: Page, proof: string): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate((contestProof) => {
    const hook = (window as unknown as { __movieGame?: DevHook }).__movieGame;
    if (!hook) throw new Error('window.__movieGame dev hook is missing');
    const state = hook.state;
    const pending = state.pendingDeclaration;
    if (!pending) return { ok: false, error: 'no pending declaration' };
    const challenger = state.players.find((player) => player.id !== pending.playerId) ?? state.players[1];
    return hook.store.dispatch({
      type: 'contest',
      playerId: challenger.id,
      declarationId: pending.id,
      proof: contestProof,
    });
  }, proof);
}

async function snapshot(page: Page): Promise<{
  pending: { title?: string; contests: number } | null;
  declared: { title?: string; verified: boolean; points: number }[];
}> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __movieGame?: DevHook }).__movieGame;
    if (!hook) throw new Error('window.__movieGame dev hook is missing');
    const state = hook.state;
    return {
      pending: state.pendingDeclaration
        ? {
            title: state.pendingDeclaration.claimedTitle,
            contests: state.pendingDeclaration.contests.length,
          }
        : null,
      declared: state.declared.map((combo) => ({
        title: combo.claimedTitle,
        verified: combo.verified,
        points: combo.points,
      })),
    };
  });
}

test('a contested claim is never auto-awarded as real when the window closes', async ({ page }) => {
  await startHotseat(page);
  const claim = await declare(page, 'The Matrix');
  expect(claim.ok, claim.error).toBe(true);

  // A challenger contests the claim through the engine — NOT the UI button — so
  // `showResolution` stays false and the original countdown interval keeps
  // running with its pre-contest closure (the exact stale-closure path).
  const contestResult = await contestViaEngine(page, 'That is not a real film');
  expect(contestResult.ok, contestResult.error).toBe(true);
  expect((await snapshot(page)).pending?.contests).toBe(1);

  // Wait past CONTEST_TIME_MS (15s) for the interval to fire `finish`.
  await page.waitForTimeout(17_000);

  const after = await snapshot(page);
  // Regression guard: the contested claim must NOT have been auto-awarded.
  expect(after.pending).not.toBeNull();
  expect(after.declared.length).toBe(0);

  // The table's ruling panel is shown, awaiting an explicit decision.
  await expect(page.locator('.claim-resolution')).toBeVisible();
});

test('contesting through the UI opens the ruling panel at once', async ({ page }) => {
  await startHotseat(page);
  await declare(page, 'The Matrix');

  const challengerName = await page.evaluate(() => {
    const hook = (window as unknown as { __movieGame?: DevHook }).__movieGame;
    if (!hook) throw new Error('window.__movieGame dev hook is missing');
    const state = hook.state;
    const pending = state.pendingDeclaration;
    return state.players.find((player) => player.id !== pending?.playerId)?.name ?? 'Player 2';
  });

  // Hotseat device-passing: act as the challenger.
  await page.getByRole('button', { name: challengerName, exact: true }).click();
  await page.getByRole('button', { name: /contest this claim/i }).click();
  await page.locator('.claim-input').fill('That is not a real film');
  await page.getByRole('button', { name: /submit contest/i }).click();

  // Ruling panel appears immediately — no waiting for a countdown.
  await expect(page.locator('.claim-resolution')).toBeVisible();
  await expect(page.locator('.claim-contests')).toContainText(/not a real film/i);
  const after = await snapshot(page);
  expect(after.pending).not.toBeNull();
});

async function scores(page: Page): Promise<Record<string, number>> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __movieGame?: DevHook }).__movieGame;
    if (!hook) throw new Error('window.__movieGame dev hook is missing');
    const map: Record<string, number> = {};
    for (const player of hook.state.players) map[player.id] = player.score;
    return map;
  });
}

/**
 * Act as the challenger, raise a contest, then rule the claim from the panel.
 * Returns the declarer/challenger ids captured BEFORE the claim resolves
 * (after resolution `pendingDeclaration` is gone, so they can't be re-derived).
 */
async function contestAndRule(page: Page, outcome: 'real' | 'fake'): Promise<{ declarer: string; challenger: string }> {
  const ids = await page.evaluate(() => {
    const hook = (window as unknown as { __movieGame?: DevHook }).__movieGame;
    if (!hook) throw new Error('window.__movieGame dev hook is missing');
    const state = hook.state;
    const declarer = state.pendingDeclaration?.playerId ?? state.players[0].id;
    const challenger =
      state.players.find((player) => player.id !== declarer)?.id ?? state.players[1].id;
    return { declarer, challenger };
  });
  const name = await page.evaluate((challengerId) => {
    const hook = (window as unknown as { __movieGame?: DevHook }).__movieGame;
    if (!hook) throw new Error('window.__movieGame dev hook is missing');
    return hook.state.players.find((player) => player.id === challengerId)?.name ?? 'Player 2';
  }, ids.challenger);
  await page.getByRole('button', { name: name, exact: true }).click();
  await page.getByRole('button', { name: /contest this claim/i }).click();
  await page.locator('.claim-input').fill('Challenging this claim');
  await page.getByRole('button', { name: /submit contest/i }).click();
  await expect(page.locator('.claim-resolution')).toBeVisible();
  await page.getByRole('button', { name: outcome === 'real' ? /real film/i : /fake claim/i }).click();
  return ids;
}

test('a ruled-fake contested claim penalizes the declarer −5 (symmetric)', async ({ page }) => {
  await startHotseat(page);
  const claim = await declare(page, 'Totally Made Up Film 12345');
  expect(claim.ok, claim.error).toBe(true);

  const { declarer, challenger } = await contestAndRule(page, 'fake');

  const after = await snapshot(page);
  expect(after.pending).toBeNull();
  expect(after.declared).toEqual([{ title: 'Totally Made Up Film 12345', verified: false, points: 0 }]);

  const result = await scores(page);
  // Declarer was wrong → pays the same −5 a wrong challenger would pay.
  expect(result[declarer]).toBe(-5);
  expect(result[challenger]).toBe(0);
});

test('a ruled-real contested claim penalizes the challenger −5 (symmetric)', async ({ page }) => {
  await startHotseat(page);
  const claim = await declare(page, 'The Matrix');
  expect(claim.ok, claim.error).toBe(true);

  const { declarer, challenger } = await contestAndRule(page, 'real');

  const after = await snapshot(page);
  expect(after.pending).toBeNull();
  expect(after.declared[0]?.verified).toBe(true);

  const result = await scores(page);
  // Challenger wrongly contested a real film → pays −5; declarer is rewarded.
  expect(result[challenger]).toBe(-5);
  expect(result[declarer]).toBeGreaterThan(0);
});
