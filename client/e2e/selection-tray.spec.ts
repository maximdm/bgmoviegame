import { expect, test, type Page } from '@playwright/test';

/**
 * Regression coverage for deselecting a card from the selection tray.
 *
 * Selected cards render in a tray; each tray chip is now a clickable "remove"
 * button (aria-label "Remove <label> from selection") so a card can be
 * deselected by clicking it there — not only by clicking the hand card again.
 */

interface DevHook {
  state: {
    players: { id: string; hand: { id: string; label: string }[] }[];
    currentPlayerIndex: number;
  };
  selectedIds: string[];
  selectCard: (cardId: string) => void;
}

async function startHotseat(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'Hotseat' }).click();
  await page.getByRole('button', { name: 'Start game' }).click();
  await page.getByRole('button', { name: 'Draw from deck' }).click();
  await page.getByRole('button', { name: 'Declare movie' }).waitFor();
}

test('a selected card can be deselected by clicking it in the selection tray', async ({ page }) => {
  await startHotseat(page);

  // Select the first card in the active hand via the dev hook.
  const cardId = await page.evaluate(() => {
    const hook = (window as unknown as { __movieGame?: DevHook }).__movieGame;
    if (!hook) throw new Error('window.__movieGame dev hook is missing (is this the dev server?)');
    const hand = hook.state.players[hook.state.currentPlayerIndex].hand;
    const id = hand[0].id;
    hook.selectCard(id);
    return id;
  });

  // The card is now in the tray as a removable chip.
  const removeButton = page.getByRole('button', { name: /^Remove .* from selection$/ });
  await expect(removeButton).toBeVisible();

  const selectedBefore = await page.evaluate(
    () => (window as unknown as { __movieGame?: DevHook }).__movieGame?.selectedIds ?? [],
  );
  expect(selectedBefore).toContain(cardId);

  // Click the tray chip to deselect.
  await removeButton.click();

  await expect(removeButton).toHaveCount(0);

  const selectedAfter = await page.evaluate(
    () => (window as unknown as { __movieGame?: DevHook }).__movieGame?.selectedIds ?? [],
  );
  expect(selectedAfter).not.toContain(cardId);
});
