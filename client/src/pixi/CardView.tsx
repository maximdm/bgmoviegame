/**
 * One face-up movie card, plus the shared face-down back.
 *
 * Positions are animated with a small cubic tween driven by the Pixi ticker so
 * selecting/lifting a card glides instead of jumping. While a card is being
 * dragged (`immediate`), it follows the pointer without animation.
 */
import { useTick } from '@pixi/react';
import {
  CATEGORY_COLORS,
  CATEGORY_LABELS,
  type Card,
} from '@movie-game/shared';
import { Container, type FederatedPointerEvent, type Graphics } from 'pixi.js';
import { useLayoutEffect, useRef } from 'react';
import { categoryIconSvg } from '../components/categoryIcons';

export const CARD_WIDTH = 96;
export const CARD_HEIGHT = 136;

const CARD_FONT = 'Poppins, Arial, sans-serif';

interface CardViewProps {
  card: Card;
  x: number;
  y: number;
  rotation?: number;
  selected?: boolean;
  interactive?: boolean;
  immediate?: boolean;
  scale?: number;
  alpha?: number;
  onPointerDown?: (event: FederatedPointerEvent) => void;
  onPointerUp?: (event: FederatedPointerEvent) => void;
  onPointerUpOutside?: (event: FederatedPointerEvent) => void;
  onPointerTap?: (event: FederatedPointerEvent) => void;
}

export function CardView({
  card,
  x,
  y,
  rotation = 0,
  selected = false,
  interactive = false,
  immediate = false,
  scale = 1,
  alpha = 1,
  onPointerDown,
  onPointerUp,
  onPointerUpOutside,
  onPointerTap,
}: CardViewProps) {
  const ref = useRef<Container>(null);
  const mounted = useRef(false);
  const animation = useRef({
    fromX: x,
    fromY: y,
    fromRotation: rotation,
    toX: x,
    toY: y,
    toRotation: rotation,
    progress: 1,
  });

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;

    if (!mounted.current || immediate) {
      mounted.current = true;
      element.x = x;
      element.y = y;
      element.rotation = rotation;
      animation.current = {
        fromX: x,
        fromY: y,
        fromRotation: rotation,
        toX: x,
        toY: y,
        toRotation: rotation,
        progress: 1,
      };
      return;
    }

    animation.current = {
      fromX: element.x,
      fromY: element.y,
      fromRotation: element.rotation,
      toX: x,
      toY: y,
      toRotation: rotation,
      progress: 0,
    };
  }, [x, y, rotation, immediate]);

  useTick((ticker) => {
    const element = ref.current;
    if (!element) return;
    const anim = animation.current;
    if (anim.progress >= 1) return;

    anim.progress = Math.min(1, anim.progress + ticker.deltaMS / 170);
    const t = 1 - (1 - anim.progress) ** 3;
    element.x = anim.fromX + (anim.toX - anim.fromX) * t;
    element.y = anim.fromY + (anim.toY - anim.fromY) * t;
    element.rotation = anim.fromRotation + (anim.toRotation - anim.fromRotation) * t;
  });

  const width = CARD_WIDTH;
  const height = CARD_HEIGHT;
  const bandColor = CATEGORY_COLORS[card.category];
  const isYear = card.category === 'ReleaseYear';

  // Sprocket holes running down the left film strip.
  const holes: number[] = [];
  for (let y = -height / 2 + 9; y <= height / 2 - 13; y += 14) {
    holes.push(y);
  }

  return (
    <pixiContainer
      ref={ref}
      scale={scale}
      alpha={alpha}
      eventMode={interactive ? 'static' : 'none'}
      cursor={interactive ? 'pointer' : undefined}
      onPointerDown={interactive ? onPointerDown : undefined}
      onPointerUp={interactive ? onPointerUp : undefined}
      onPointerUpOutside={interactive ? onPointerUpOutside : undefined}
      onPointerTap={interactive ? onPointerTap : undefined}
    >
      <pixiGraphics
        draw={(g) => {
          g.clear();

          if (selected) {
            g.roundRect(-width / 2 - 4, -height / 2 - 4, width + 8, height + 8, 14).fill({
              color: 0xf5c542,
              alpha: 0.22,
            });
          }

          // Card body.
          g.roundRect(-width / 2, -height / 2, width, height, 11)
            .fill(0x15171f)
            .stroke({
              width: selected ? 2.5 : 1.5,
              color: selected ? 0xf5c542 : bandColor,
            });

          // Film strip down the left edge.
          g.roundRect(-width / 2 + 1, -height / 2 + 1, 13, height - 2, 6).fill(0x0b0d12);
          g.rect(-width / 2 + 13, -height / 2 + 1, 1, height - 2).fill({ color: 0x000000, alpha: 0.55 });
          for (const y of holes) {
            g.roundRect(-width / 2 + 3, y, 7, 5, 2).fill(0x3a4156);
          }

          // Category colour accent bar above the body content.
          g.rect(-width / 2 + 16, -height / 2 + 1, width - 17, 3).fill({
            color: bandColor,
            alpha: 0.9,
          });
        }}
      />

      <pixiGraphics
        x={-width / 2 + 22}
        y={-height / 2 + 11}
        scale={0.85}
        draw={(g) => {
          g.clear();
          g.svg(
            categoryIconSvg(
              card.category,
              `#${bandColor.toString(16).padStart(6, '0')}`,
            ),
          );
        }}
      />

      <pixiText
        text={CATEGORY_LABELS[card.category].toUpperCase()}
        x={-width / 2 + 22}
        y={-height / 2 + 32}
        anchor={0}
        style={{
          fontFamily: CARD_FONT,
          fontSize: 8,
          fontWeight: '800',
          letterSpacing: 0.9,
          fill: bandColor,
        }}
      />

      <pixiText
        text={card.label}
        x={7.5}
        y={isYear ? 18 : 16}
        anchor={0.5}
        style={{
          fontFamily: CARD_FONT,
          fontSize: isYear ? 26 : 12.5,
          fontWeight: '700',
          fill: 0xf3f6ff,
          align: 'center',
          wordWrap: true,
          wordWrapWidth: width - 28,
          breakWords: true,
          lineHeight: 14,
        }}
      />

      <pixiText
        text="MOVIE GAME"
        x={7.5}
        y={height / 2 - 10}
        anchor={0.5}
        style={{
          fontFamily: CARD_FONT,
          fontSize: 7,
          fontWeight: '700',
          letterSpacing: 1.4,
          fill: 0x79839c,
        }}
      />
    </pixiContainer>
  );
}

interface CardBackProps {
  x: number;
  y: number;
  rotation?: number;
  width?: number;
  height?: number;
  alpha?: number;
}

interface MaskStyle {
  fill: number;
  stroke?: number;
  strokeWidth?: number;
  eye: number;
  eyeHappy: boolean;
  mouth: number;
  mouthHappy: boolean;
}

/** Draw one theatrical mask (shield face) centred at the local origin. */
function drawMask(g: Graphics, c: MaskStyle) {
  // Shield silhouette.
  g.moveTo(-52, -62);
  g.quadraticCurveTo(0, -74, 52, -62);
  g.lineTo(46, 16);
  g.quadraticCurveTo(42, 60, 0, 76);
  g.quadraticCurveTo(-42, 60, -46, 16);
  g.closePath();
  if (c.stroke !== undefined) {
    g.fill(c.fill).stroke({ width: c.strokeWidth ?? 6, color: c.stroke, join: 'round' });
  } else {
    g.fill(c.fill);
  }

  // Eyes: upward arc for comedy, downward arc for tragedy.
  const ey = c.eyeHappy ? -10 : -14;
  const ctrlY = c.eyeHappy ? -24 : -4;
  g.moveTo(-32, ey);
  g.quadraticCurveTo(-20, ctrlY, -8, ey);
  g.moveTo(8, ey);
  g.quadraticCurveTo(20, ctrlY, 32, ey);
  g.stroke({ width: 5.5, color: c.eye, cap: 'round' });

  // Mouth: smiling for comedy, frowning for tragedy.
  if (c.mouthHappy) {
    g.moveTo(-26, 20);
    g.quadraticCurveTo(0, 26, 26, 20);
    g.quadraticCurveTo(20, 48, 0, 48);
    g.quadraticCurveTo(-20, 48, -26, 20);
    g.closePath();
  } else {
    g.moveTo(-24, 42);
    g.quadraticCurveTo(0, 20, 24, 42);
    g.closePath();
  }
  g.fill(c.mouth);
}

/** Face-down card used for piles and hidden opponent hands: theatrical masks. */
export function CardBack({
  x,
  y,
  rotation = 0,
  width = CARD_WIDTH,
  height = CARD_HEIGHT,
  alpha = 1,
}: CardBackProps) {
  // The two masks sit in a 320×260 composition; scale it to fit the card.
  const scale = Math.min((width - 16) / 320, (height - 16) / 260);
  const DEG = Math.PI / 180;

  const comedy: MaskStyle = {
    fill: 0xf59e0b,
    stroke: 0xffffff,
    strokeWidth: 6,
    eye: 0x1e293b,
    eyeHappy: true,
    mouth: 0x1e293b,
    mouthHappy: true,
  };
  const tragedy: MaskStyle = {
    fill: 0x334155,
    eye: 0xf8fafc,
    eyeHappy: false,
    mouth: 0xf8fafc,
    mouthHappy: false,
  };

  return (
    <pixiContainer x={x} y={y} rotation={rotation} alpha={alpha}>
      <pixiGraphics
        draw={(g) => {
          g.clear();
          g.roundRect(-width / 2, -height / 2, width, height, 11)
            .fill(0x140f17)
            .stroke({ width: 2, color: 0xd9a441 });
          g.roundRect(-width / 2 + 6, -height / 2 + 6, width - 12, height - 12, 7).stroke({
            width: 1,
            color: 0xd9a441,
            alpha: 0.5,
          });
        }}
      />
      <pixiContainer x={-160 * scale} y={-130 * scale} scale={scale}>
        <pixiContainer x={115} y={122} rotation={-12 * DEG}>
          <pixiGraphics draw={(g) => drawMask(g, comedy)} />
        </pixiContainer>
        <pixiContainer x={205} y={138} rotation={12 * DEG}>
          <pixiGraphics draw={(g) => drawMask(g, tragedy)} />
        </pixiContainer>
      </pixiContainer>
    </pixiContainer>
  );
}
