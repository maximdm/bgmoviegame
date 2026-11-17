/**
 * The PixiJS table: draw/discard piles, hidden opponent hands, and the active
 * player's fanned hand. All rules live in the shared engine — this component
 * only renders state and reports gestures.
 */
import { Application } from '@pixi/react';
import type { GameState } from '@movie-game/shared';
import type { FederatedPointerEvent } from 'pixi.js';
import { useMemo, useRef, useState } from 'react';
import { CARD_HEIGHT, CARD_WIDTH, CardBack, CardView } from './CardView';
import './register';

const WIDTH = 1040;
const HEIGHT = 680;
const HAND_Y = 590;
const HAND_DROP_LINE = HAND_Y - 70;
const PILE_Y = 300;
const DRAW_X = 360;
const DISCARD_X = 680;

const PILE_LABEL_STYLE = {
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  fontWeight: '700',
  letterSpacing: 1.6,
  fill: 0x8fb7a3,
} as const;

const PILE_COUNT_STYLE = {
  fontFamily: 'Georgia, serif',
  fontSize: 20,
  fontWeight: '700',
  fill: 0xe8eefc,
} as const;

interface BoardProps {
  state: GameState;
  /** Whose eyes this board is drawn for; that seat's hand is shown face-up. */
  viewerId: string;
  selectedIds: ReadonlySet<string>;
  onToggleCard: (cardId: string) => void;
  onDraw: (source: 'deck' | 'discard') => void;
  /** Discard the currently selected card (enabled from the floating button). */
  onDiscard?: () => void;
}

interface DragState {
  cardId: string;
  x: number;
  y: number;
  startClientX: number;
  startClientY: number;
  wasSelected: boolean;
}

export function Board({ state, viewerId, selectedIds, onToggleCard, onDraw, onDiscard }: BoardProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragLive = useRef(false);
  const boardRef = useRef<HTMLDivElement>(null);

  const activePlayer = state.players[state.currentPlayerIndex];
  const viewer = state.players.find((player) => player.id === viewerId) ?? activePlayer;
  const hand = viewer.hand;
  // Only the seat on turn may touch the cards, and only its own.
  const canPlay =
    state.phase === 'discard' && state.players[state.currentPlayerIndex]?.id === viewer.id;

  const handLayout = useMemo(() => {
    const count = hand.length;
    const spacing = count > 1 ? Math.min(CARD_WIDTH - 4, 820 / (count - 1)) : 0;
    const totalWidth = spacing * (count - 1);
    const startX = WIDTH / 2 - totalWidth / 2;

    return hand.map((card, index) => {
      const fan = count > 1 ? index / (count - 1) - 0.5 : 0;
      return {
        card,
        x: startX + index * spacing,
        y: HAND_Y - (selectedIds.has(card.id) ? 28 : 0),
        rotation: fan * 0.07,
      };
    });
  }, [hand, selectedIds]);

  const opponents = state.players.filter((player) => player.id !== viewer.id);
  const opponentGap = Math.min(180, (WIDTH - 280) / Math.max(1, opponents.length - 1));
  const opponentStart = WIDTH / 2 - (opponentGap * (opponents.length - 1)) / 2;

  const canDraw = state.phase === 'draw' && activePlayer.id === viewer.id;
  const draggedCard = drag ? hand.find((card) => card.id === drag.cardId) : undefined;
  const topDiscard = state.discardPile[state.discardPile.length - 1];

  const startDrag = (event: FederatedPointerEvent, cardId: string): void => {
    if (!canPlay) return;
    event.stopPropagation();

    const next: DragState = {
      cardId,
      x: event.global.x,
      y: event.global.y,
      startClientX: event.clientX,
      startClientY: event.clientY,
      wasSelected: selectedIds.has(cardId),
    };
    dragRef.current = next;
    dragLive.current = true;
    setDrag(next);

    // Finish on the native release event: fast clicks can land before the Pixi
    // drag overlay has mounted, so canvas-only handlers are not enough.
    const finish = (release: PointerEvent): void => {
      window.removeEventListener('pointerup', finish);
      window.removeEventListener('pointercancel', finish);
      finishDragAt(release.clientX, release.clientY);
    };
    window.addEventListener('pointerup', finish, { once: true });
    window.addEventListener('pointercancel', finish, { once: true });
  };

  const moveDrag = (event: FederatedPointerEvent): void => {
    setDrag((current) =>
      current ? { ...current, x: event.global.x, y: event.global.y } : current,
    );
  };

  const finishDragAt = (clientX: number, clientY: number): void => {
    const current = dragRef.current;
    if (!dragLive.current || !current) return;
    dragLive.current = false;
    dragRef.current = null;

    const rect = boardRef.current?.querySelector('canvas')?.getBoundingClientRect();
    const logicalY =
      rect && rect.height > 0 ? ((clientY - rect.top) / rect.height) * HEIGHT : current.y;
    const moved =
      Math.hypot(clientX - current.startClientX, clientY - current.startClientY) > 8;
    const droppedUp = logicalY < HAND_DROP_LINE;
    const droppedDown = logicalY > HAND_Y + 12;

    if (!moved || (droppedUp && !current.wasSelected) || (droppedDown && current.wasSelected)) {
      onToggleCard(current.cardId);
    }
    setDrag(null);
  };

  const finishDrag = (event: FederatedPointerEvent): void => {
    finishDragAt(event.clientX, event.clientY);
  };

  return (
    <div className="board" ref={boardRef}>
      <Application
        width={WIDTH}
        height={HEIGHT}
        background={0x0b2018}
        antialias
        resolution={Math.min(window.devicePixelRatio || 1, 2)}
        autoDensity
      >
        <pixiGraphics
          draw={(g) => {
            g.clear();
            g.rect(0, 0, WIDTH, HEIGHT).fill(0x0b2018);
            g.roundRect(14, 14, WIDTH - 28, HEIGHT - 28, 26)
              .fill(0x113227)
              .stroke({ width: 2, color: 0x1e5a43 });
            g.ellipse(WIDTH / 2, PILE_Y, 405, 178).fill({ color: 0x14402f, alpha: 0.55 });
            g.moveTo(70, PILE_Y + 176)
              .lineTo(WIDTH - 70, PILE_Y + 176)
              .stroke({ width: 1, color: 0x1a4a37, alpha: 0.7 });
          }}
        />

        {opponents.map((opponent, index) => {
          const x = opponentStart + index * opponentGap;
          return (
            <pixiContainer key={opponent.id} x={x} y={100}>
              <pixiText
                text={opponent.name}
                x={0}
                y={-70}
                anchor={0.5}
                style={{
                  fontFamily: 'system-ui, sans-serif',
                  fontSize: 13,
                  fontWeight: '700',
                  fill: 0xe8eefc,
                }}
              />
              <pixiText
                text={`${opponent.score} pts`}
                x={0}
                y={-54}
                anchor={0.5}
                style={{
                  fontFamily: 'system-ui, sans-serif',
                  fontSize: 11,
                  fill: 0x9fb3d9,
                }}
              />
              <CardBack x={2} y={2} width={56} height={78} alpha={0.75} />
              <CardBack x={0} y={0} width={56} height={78} />
              <pixiText
                text={`${opponent.hand.length} cards`}
                x={0}
                y={56}
                anchor={0.5}
                style={{
                  fontFamily: 'system-ui, sans-serif',
                  fontSize: 10,
                  fontWeight: '600',
                  letterSpacing: 0.6,
                  fill: 0x8fb7a3,
                }}
              />
            </pixiContainer>
          );
        })}

        <pixiText
          text="DRAW PILE"
          x={DRAW_X}
          y={208}
          anchor={0.5}
          style={PILE_LABEL_STYLE}
        />
        <pixiText
          text={String(state.drawPile.length)}
          x={DRAW_X}
          y={226}
          anchor={0.5}
          style={PILE_COUNT_STYLE}
        />

        {state.drawPile.length > 0 ? (
          <>
            <CardBack x={DRAW_X + 5} y={PILE_Y + 5} />
            <CardBack x={DRAW_X + 2.5} y={PILE_Y + 2.5} />
            <CardBack x={DRAW_X} y={PILE_Y} />
          </>
        ) : (
          <pixiGraphics
            draw={(g) => {
              g.clear();
              g.roundRect(
                DRAW_X - CARD_WIDTH / 2,
                PILE_Y - CARD_HEIGHT / 2,
                CARD_WIDTH,
                CARD_HEIGHT,
                11,
              ).stroke({ width: 1.5, color: 0x3d6b57, alpha: 0.9 });
            }}
          />
        )}

        <pixiText
          text="DISCARD"
          x={DISCARD_X}
          y={208}
          anchor={0.5}
          style={PILE_LABEL_STYLE}
        />
        <pixiText
          text={String(state.discardPile.length)}
          x={DISCARD_X}
          y={226}
          anchor={0.5}
          style={PILE_COUNT_STYLE}
        />

        {state.discardPile.length === 0 ? (
          <pixiGraphics
            draw={(g) => {
              g.clear();
              g.roundRect(
                DISCARD_X - CARD_WIDTH / 2,
                PILE_Y - CARD_HEIGHT / 2,
                CARD_WIDTH,
                CARD_HEIGHT,
                11,
              ).stroke({ width: 1.5, color: 0x3d6b57, alpha: 0.9 });
            }}
          />
        ) : (
          state.discardPile.slice(-3).map((card, index, visible) => {
            const isTop = index === visible.length - 1;
            return (
              <CardView
                key={card.id}
                card={card}
                x={DISCARD_X + (index - 1) * 5}
                y={PILE_Y + (index - 1) * 3}
                rotation={(index - 1) * 0.045}
                interactive={isTop && canDraw}
                onPointerTap={() => onDraw('discard')}
              />
            );
          })
        )}

        {canDraw && state.drawPile.length > 0 && (
          <pixiContainer
            eventMode="static"
            cursor="pointer"
            onPointerTap={() => onDraw('deck')}
          >
            <pixiGraphics
              draw={(g) => {
                g.clear();
                g.rect(
                  DRAW_X - CARD_WIDTH / 2 - 4,
                  PILE_Y - CARD_HEIGHT / 2 - 4,
                  CARD_WIDTH + 8,
                  CARD_HEIGHT + 8,
                ).fill({ color: 0xffffff, alpha: 0.001 });
              }}
            />
          </pixiContainer>
        )}

        {handLayout.map(({ card, x, y, rotation }) => (
          <CardView
            key={card.id}
            card={card}
            x={x}
            y={y}
            rotation={rotation}
            alpha={drag?.cardId === card.id ? 0.001 : 1}
            selected={selectedIds.has(card.id)}
            interactive={canPlay}
            onPointerDown={(event) => startDrag(event, card.id)}
            onPointerUp={finishDrag}
            onPointerUpOutside={finishDrag}
          />
        ))}

        <pixiText
          text={
            viewer.id === activePlayer.id
              ? `${viewer.name.toUpperCase()}  ·  ${viewer.score} PTS  ·  ${hand.length} CARDS`
              : `YOUR HAND  ·  ${viewer.score} PTS  ·  ${hand.length} CARDS  —  ${activePlayer.name.toUpperCase()}'S TURN`
          }
          x={WIDTH / 2}
          y={HEIGHT - 16}
          anchor={0.5}
          style={{
            fontFamily: 'system-ui, sans-serif',
            fontSize: 10,
            fontWeight: '700',
            letterSpacing: 1.4,
            fill: 0x7fa793,
          }}
        />

        {drag && (
          <pixiGraphics
            draw={(g) => {
              g.clear();
              g.rect(0, 0, WIDTH, HEIGHT).fill({ color: 0x000000, alpha: 0.001 });
            }}
            eventMode="static"
            onPointerMove={moveDrag}
            onPointerUp={finishDrag}
            onPointerUpOutside={finishDrag}
          />
        )}

        {drag && draggedCard && (
          <CardView
            card={draggedCard}
            x={drag.x}
            y={drag.y}
            rotation={0}
            selected={selectedIds.has(drag.cardId)}
            interactive={false}
            immediate
            scale={1.06}
          />
        )}
      </Application>

      {state.phase === 'draw' && topDiscard && (
        <p className="board__hint">Top discard: {topDiscard.label}</p>
      )}

      <div className="board__actions">
        {canDraw && state.drawPile.length > 0 && (
          <button
            type="button"
            className="board__action board__action--deck"
            onClick={() => onDraw('deck')}
          >
            Draw
          </button>
        )}
        {canDraw && (
          <button
            type="button"
            className="board__action board__action--discard"
            disabled={!topDiscard}
            onClick={() => onDraw('discard')}
          >
            Take
          </button>
        )}
        {canPlay && selectedIds.size === 1 && (
          <button
            type="button"
            className="board__action board__action--discard"
            onClick={() => onDiscard?.()}
          >
            Discard
          </button>
        )}
      </div>
    </div>
  );
}
