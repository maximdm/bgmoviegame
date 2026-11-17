import { expect, test, type Page } from '@playwright/test';

/**
 * Regression coverage for the selection tray.
 *
 * Selected cards render in a tray; each tray chip is a clickable "remove" button
 * (aria-label "Remove <label> from selection") so a card can be deselected by
 * clicking it there — not only by clicking the hand card again. The tray also
 * exposes a trash drop zone: drag a chip onto it to remove just that card, or
 * click it to clear the whole selection.
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

  const cardId = await page.evaluate(() => {
    const hook = (window as unknown as { __movieGame?: DevHook }).__movieGame;
    if (!hook) throw new Error('window.__movieGame dev hook is missing (is this the dev server?)');
    const hand = hook.state.players[hook.state.currentPlayerIndex].hand;
    const id = hand[0].id;
    hook.selectCard(id);
    return id;
  });

  const removeButton = page.getByRole('button', { name: /^Remove .* from selection$/ });
  await expect(removeButton).toBeVisible();

  const selectedBefore = await page.evaluate(
    () => (window as unknown as { __movieGame?: DevHook }).__movieGame?.selectedIds ?? [],
  );
  expect(selectedBefore).toContain(cardId);

  await removeButton.click();

  await expect(removeButton).toHaveCount(0);

  const selectedAfter = await page.evaluate(
    () => (window as unknown as { __movieGame?: DevHook }).__movieGame?.selectedIds ?? [],
  );
  expect(selectedAfter).not.toContain(cardId);
});

test('dragging a selected card onto the trash zone removes just that card', async ({ page }) => {
  await startHotseat(page);

  const ids = await page.evaluate(() => {
    const hook = (window as unknown as { __movieGame?: DevHook }).__movieGame;
    if (!hook) throw new Error('window.__movieGame dev hook is missing (is this the dev server?)');
    const hand = hook.state.players[hook.state.currentPlayerIndex].hand;
    hook.selectCard(hand[0].id);
    hook.selectCard(hand[1].id);
    return [hand[0].id, hand[1].id];
  });

  const zone = page.getByRole('button', { name: /Drop a card here/ });
  await expect(zone).toBeVisible();

  // Native HTML5 drag-and-drop can't be driven by Playwright's mouse API, so we
  // dispatch the dragover + drop events the chip's dragstart populates.
  await page.evaluate((droppedId) => {
    const target = document.querySelector('.selection__trash');
    if (!target) throw new Error('trash drop zone not found');
    const dt = new DataTransfer();
    dt.setData('text/plain', droppedId);
    target.dispatchEvent(
      new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt }),
    );
    target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, ids[0]);

  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __movieGame?: DevHook }).__movieGame?.selectedIds ?? []))
    .not.toContain(ids[0]);
  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __movieGame?: DevHook }).__movieGame?.selectedIds ?? []))
    .toContain(ids[1]);
});

test('clicking the trash zone clears the whole selection', async ({ page }) => {
  await startHotseat(page);

  await page.evaluate(() => {
    const hook = (window as unknown as { __movieGame?: DevHook }).__movieGame;
    if (!hook) throw new Error('window.__movieGame dev hook is missing (is this the dev server?)');
    const hand = hook.state.players[hook.state.currentPlayerIndex].hand;
    hook.selectCard(hand[0].id);
    hook.selectCard(hand[1].id);
    hook.selectCard(hand[2].id);
  });

  const zone = page.getByRole('button', { name: /Drop a card here/ });
  await expect(zone).toBeVisible();

  await zone.click();

  await expect
    .poll(async () => page.evaluate(() => (window as unknown as { __movieGame?: DevHook }).__movieGame?.selectedIds ?? []))
    .toHaveLength(0);
});
