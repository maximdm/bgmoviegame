import {
  CATEGORY_CSS_COLORS,
  CATEGORY_LABELS,
  type Card,
} from '@movie-game/shared';
import type { CSSProperties } from 'react';
import { useState } from 'react';
import { categoryIconSvg } from './categoryIcons';

/**
 * A small movie-themed card: a sprocket-hole film strip runs down the left edge,
 * an SVG icon marks the category, and the category colour tints the frame. Used
 * in the selection tray, the declared-combo grid and the board hand. The Pixi
 * `CardView` on the cards variant board mirrors this look.
 *
 * When the card's movie has a poster, it is shown as a cover image with a
 * legibility scrim (and the film strip is dropped); if the image fails to load,
 * we fall back to the plain colour/label card.
 */
export function CardChip({ card }: { card: Card }) {
  const color = CATEGORY_CSS_COLORS[card.category];
  const style = { '--cat': color } as CSSProperties;
  const [posterFailed, setPosterFailed] = useState(false);
  const showPoster = Boolean(card.posterUrl) && !posterFailed;

  return (
    <span className={`movie-card${showPoster ? ' movie-card--poster' : ''}`} style={style}>
      {showPoster && (
        <img
          className="movie-card__poster"
          src={card.posterUrl}
          alt=""
          loading="lazy"
          decoding="async"
          onError={() => setPosterFailed(true)}
        />
      )}
      {showPoster && <span className="movie-card__scrim" aria-hidden="true" />}
      {!showPoster && <span className="movie-card__film" aria-hidden="true" />}
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
