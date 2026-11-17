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
 *
 * Pass `onRemove` to render the chip as a clickable "remove" button (used in the
 * selection tray so a selected card can be deselected by clicking it there, not
 * just by clicking the hand card again). Omit it and the chip is a static
 * `<span>` as before.
 */
interface CardChipProps {
  card: Card;
  onRemove?: (cardId: string) => void;
}

export function CardChip({ card, onRemove }: CardChipProps) {
  const color = CATEGORY_CSS_COLORS[card.category];
  const style = { '--cat': color } as CSSProperties;
  const [posterFailed, setPosterFailed] = useState(false);
  const showPoster = Boolean(card.posterUrl) && !posterFailed;

  const inner = (
    <>
      {showPoster ? (
        <>
          <img
            className="movie-card__poster"
            src={card.posterUrl}
            alt=""
            loading="lazy"
            decoding="async"
            onError={() => setPosterFailed(true)}
          />
          <span className="movie-card__scrim" aria-hidden="true" />
        </>
      ) : (
        <span className="movie-card__film" aria-hidden="true" />
      )}
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
      {onRemove && <span className="movie-card__remove" aria-hidden="true">×</span>}
    </>
  );

  if (onRemove) {
    return (
      <button
        type="button"
        className={`movie-card movie-card--removable${showPoster ? ' movie-card--poster' : ''}`}
        style={style}
        onClick={() => onRemove(card.id)}
        aria-label={`Remove ${card.label} from selection`}
      >
        {inner}
      </button>
    );
  }

  return (
    <span className={`movie-card${showPoster ? ' movie-card--poster' : ''}`} style={style}>
      {inner}
    </span>
  );
}
