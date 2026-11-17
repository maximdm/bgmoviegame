import {
  CATEGORY_CSS_COLORS,
  CATEGORY_LABELS,
  type Card,
} from '@movie-game/shared';
import type { CSSProperties } from 'react';
import { categoryIconSvg } from './categoryIcons';

/**
 * A small movie-themed card: a sprocket-hole film strip runs down the left edge,
 * an SVG icon marks the category, and the category colour tints the frame. Used
 * in the selection tray, the declared-combo grid and the board hand. The Pixi
 * `CardView` on the cards variant board mirrors this look.
 */
export function CardChip({ card }: { card: Card }) {
  const color = CATEGORY_CSS_COLORS[card.category];
  const style = { '--cat': color } as CSSProperties;
  return (
    <span className="movie-card" style={style}>
      <span className="movie-card__film" aria-hidden="true" />
      <span className="movie-card__body">
        <span className="movie-card__head">
          <span
            className="movie-card__icon"
            aria-hidden="true"
            dangerouslySetInnerHTML={{ __html: categoryIconSvg(card.category) }}
          />
          <span className="movie-card__category">{CATEGORY_LABELS[card.category]}</span>
        </span>
        <span className="movie-card__label">{card.label}</span>
        <span className="movie-card__footer">MOVIE GAME</span>
      </span>
    </span>
  );
}
