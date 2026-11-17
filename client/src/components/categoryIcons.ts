import type { Category } from '@movie-game/shared';

/**
 * Hand-drawn SVG icon glyphs (24×24, `currentColor`) for each card category.
 * Shared by the DOM `CardChip` and the Pixi `CardView` so both renderers show
 * the identical art. `currentColor` lets the DOM inherit the category colour via
 * CSS; for Pixi we substitute the numeric colour before parsing.
 */
const INNER: Record<Category, string> = {
  // Performer: head + shoulders silhouette.
  Actor: `<circle cx="12" cy="8.2" r="4.1" /><path d="M4.2 21c0-4.4 3.5-7.8 7.8-7.8s7.8 3.4 7.8 7.8z" />`,
  // Star performer.
  Actress: `<path d="M12 2.5l2.7 5.9 6.4.6-4.8 4.3 1.4 6.3L12 17.6 6.3 19.6l1.4-6.3L2.9 9l6.4-.6z" />`,
  // Hourglass (period / era).
  Period: `<path d="M7 3.2h10v2.9l-3.1 3.7 3.1 3.7v2.9H7v-2.9l3.1-3.7L7 6.1z" />`,
  // Location pin (setting / place).
  Setting: `<path d="M12 2.4c-3.4 0-6.1 2.7-6.1 6.1 0 4.4 6.1 12 6.1 12s6.1-7.6 6.1-12c0-3.4-2.7-6.1-6.1-6.1z" /><circle cx="12" cy="8.4" r="2.4" fill="#15171f" />`,
  // Calendar (release year).
  ReleaseYear: `<rect x="4" y="5.2" width="16" height="15.2" rx="2" /><path d="M4 9.2h16M8.4 3.2v4M15.6 3.2v4" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round" />`,
  // Film strip (genre).
  Genre: `<rect x="3.4" y="5.2" width="17.2" height="13.6" rx="2.2" /><circle cx="7.2" cy="8" r="1.1" /><circle cx="16.8" cy="8" r="1.1" /><circle cx="7.2" cy="16" r="1.1" /><circle cx="16.8" cy="16" r="1.1" />`,
};

/** Build a standalone SVG string for a category icon. */
export function categoryIconSvg(category: Category, color?: string): string {
  const fill = color ?? 'currentColor';
  const inner = INNER[category].replace(/currentColor/g, fill);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="${fill}">${inner}</svg>`;
}
