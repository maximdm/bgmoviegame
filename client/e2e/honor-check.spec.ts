import { expect, test, type Page } from '@playwright/test';

/**
 * The vs-AI honor check.
 *
 * In a two-seat game against bots nobody can contest the human's claim, so the
 * declarer verifies it themselves: confirm a real film to claim the held points,
 * or withdraw a fake one and pay CONTEST_PENALTY. These specs drive the real
 * overlay and assert the engine state afterwards.
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
}

interface DevPendingDeclaration {
  claimedTitle?: string;
  contests: unknown[];
}

interface DevDeclaredCombo {
  claimedTitle?: string;
  verified: boolean;
  points: number;
}

interface DevState {
  players: DevPlayer[];
  currentPlayerIndex: number;
  pendingDeclaration: DevPendingDeclaration | null;
  declared: DevDeclaredCombo[];
}

interface DevHook {
  state: DevState;
  store: {
    dispatch(action: unknown): { ok: boolean; error?: string };
  };
}

interface Snapshot {
  pending: { title?: string; contests: number } | null;
  score: number;
  declared: { title?: string; verified: boolean; points: number }[];
}

/** Start a fresh 2-seat vs-AI game and draw, leaving the human ready to declare. */
async function startVsAi(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'vs AI' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.getByRole('button', { name: 'Draw from deck' }).click();
  await page.getByRole('button', { name: 'Declare movie' }).waitFor();
}

/**
 * Submit a valid 2-card / 2-category claim through the dev hook — the same
 * dispatch the naming overlay performs. (The hand itself is Pixi canvas, so
 * clicking cards is not DOM-selectable; everything downstream is real UI.)
 */
async function declare(page: Page, title: string): Promise<{ ok: boolean; error?: string }> {
  return page.evaluate((claimedTitle) => {
    const hook = (window as unknown as { __movieGame?: DevHook }).__movieGame;
    if (!hook) throw new Error('window.__movieGame dev hook is missing (is this the dev server?)');
    const state = hook.state;
    const declarer = state.players[state.currentPlayerIndex];
    const isCast = (card: DevCard): boolean => card.category === 'Actor' || card.category === 'Actress';
    // Prefer a pair spanning two categories that includes an Actor/Actress, since
    // a castless combo incurs the no-cast penalty and would change the score.
    let fallback: [string, string] | null = null;
    for (let i = 0; i < declarer.hand.length; i += 1) {
      for (let j = i + 1; j < declarer.hand.length; j += 1) {
        if (declarer.hand[i].category !== declarer.hand[j].category) {
          if (!fallback) fallback = [declarer.hand[i].id, declarer.hand[j].id];
          if (isCast(declarer.hand[i]) || isCast(declarer.hand[j])) {
            const result = hook.store.dispatch({
              type: 'declare',
              playerId: declarer.id,
              cardIds: [declarer.hand[i].id, declarer.hand[j].id],
              claimedTitle,
            });
            return { ok: result.ok, error: result.error };
          }
        }
      }
    }
    if (fallback) {
      const result = hook.store.dispatch({
        type: 'declare',
        playerId: declarer.id,
        cardIds: fallback,
        claimedTitle,
      });
      return { ok: result.ok, error: result.error };
    }
    return { ok: false, error: 'no 2-category pair in hand' };
  }, title);
}

async function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const hook = (window as unknown as { __movieGame?: DevHook }).__movieGame;
    if (!hook) throw new Error('window.__movieGame dev hook is missing');
    const state = hook.state;
    const human = state.players.find((player) => player.kind === 'human');
    if (!human) throw new Error('no human seat');
    return {
      pending: state.pendingDeclaration
        ? {
            title: state.pendingDeclaration.claimedTitle,
            contests: state.pendingDeclaration.contests.length,
          }
        : null,
      score: human.score,
      declared: state.declared.map((combo) => ({
        title: combo.claimedTitle,
        verified: combo.verified,
        points: combo.points,
      })),
    };
  });
}

test.describe('vs-AI honor check', () => {
  test('a real claim is self-confirmed and never auto-awards', async ({ page }) => {
    await startVsAi(page);
    const claim = await declare(page, 'The Matrix');
    expect(claim.ok, claim.error).toBe(true);

    const honor = page.locator('.claim-honor');
    await expect(honor).toBeVisible();
    await expect(honor).toContainText(/on your honor/i);
    await expect(page.locator('.trivia-timer')).toHaveText('Your call');
    await expect(honor.getByRole('button', { name: /yes, it.s real/i })).toBeVisible();
    await expect(honor.getByRole('button', { name: /no, withdraw/i })).toBeVisible();

    // Regression guard: this claim used to auto-award when the 15s window closed.
    await page.waitForTimeout(16_000);
    await expect(honor).toBeVisible();
    expect((await snapshot(page)).pending).not.toBeNull();

    await honor.getByRole('button', { name: /yes, it.s real/i }).click();
    await expect(honor).toBeHidden();

    const after = await snapshot(page);
    expect(after.pending).toBeNull();
    // 2 cards (4 base) + the held 10-point real-movie bonus.
    expect(after.score).toBe(14);
    expect(after.declared).toEqual([{ title: 'The Matrix', verified: true, points: 14 }]);

    const combo = page.locator('.combo-card').first();
    await expect(combo).toContainText('The Matrix');
    await expect(combo).toContainText('Verified');
  });

  test('withdrawing a fake claim costs the declarer the penalty', async ({ page }) => {
    await startVsAi(page);
    const claim = await declare(page, 'Definitely Not A Real Movie 9000');
    expect(claim.ok, claim.error).toBe(true);

    const honor = page.locator('.claim-honor');
    await expect(honor).toBeVisible();
    await honor.getByRole('button', { name: /no, withdraw/i }).click();
    await expect(honor).toBeHidden();

    const after = await snapshot(page);
    expect(after.pending).toBeNull();
    expect(after.score).toBe(-5);
    expect(after.declared).toEqual([
      { title: 'Definitely Not A Real Movie 9000', verified: false, points: 0 },
    ]);

    const combo = page.locator('.combo-card').first();
    await expect(combo).toContainText('Rejected');
  });
});
