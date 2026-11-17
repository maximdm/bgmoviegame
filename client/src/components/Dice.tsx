import { useEffect, useRef, useState, type CSSProperties } from 'react';

/**
 * A real, tumbling six-sided die rendered with CSS 3D transforms. Each face is a
 * square showing the correct pip layout; when `value` changes the cube spins a
 * couple of full turns and settles on the requested face. Clicking the die
 * triggers `onRoll` (wired to the board's roll action by the caller).
 */

/** Cube rotation that brings each value to the front face. */
const FACE_ROT: Record<number, { x: number; y: number }> = {
  1: { x: 0, y: 0 },
  2: { x: 0, y: -90 },
  3: { x: -90, y: 0 },
  4: { x: 90, y: 0 },
  5: { x: 0, y: 90 },
  6: { x: 0, y: 180 },
};

/** Which of the 9 grid cells (0..8, row-major) carry a pip for each value. */
const PIPS: Record<number, number[]> = {
  1: [4],
  2: [0, 8],
  3: [0, 4, 8],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

export interface DiceProps {
  /** Face (1–6) the die should display. */
  value: number;
  /** When provided the die becomes clickable and rolls on click. */
  onRoll?: () => void;
  /** Pixel size of the die cube. */
  size?: number;
  /** Optional per-face colours (index 0 = face 1 … index 5 = face 6). Tints each
   * side so, e.g., the dice variant can colour each face by its category. */
  faceColors?: string[];
}

export function Dice({ value, onRoll, size = 78, faceColors }: DiceProps) {
  const target = Math.min(6, Math.max(1, Math.round(value)));
  const acc = useRef({ x: 0, y: 0 });
  const mounted = useRef(false);
  const [transform, setTransform] = useState(() => {
    const r = FACE_ROT[target];
    return `rotateX(${r.x}deg) rotateY(${r.y}deg)`;
  });

  useEffect(() => {
    const r = FACE_ROT[target];
    // On first paint just show the face; afterwards add full spins so it tumbles.
    if (!mounted.current) {
      mounted.current = true;
      setTransform(`rotateX(${r.x}deg) rotateY(${r.y}deg)`);
      return;
    }
    // Two extra full turns on each axis gives a satisfying, visible roll.
    acc.current.x += 360 * 2;
    acc.current.y += 360 * 2;
    setTransform(`rotateX(${acc.current.x + r.x}deg) rotateY(${acc.current.y + r.y}deg)`);
  }, [target]);

  const interactive = typeof onRoll === 'function';

  const style = {
    width: size,
    height: size,
    '--size': `${size}px`,
  } as CSSProperties;

  return (
    <div
      className={`dice ${interactive ? 'is-interactive' : ''}`}
      style={style}
      onClick={interactive ? onRoll : undefined}
      role={interactive ? 'button' : undefined}
      aria-label={interactive ? 'Roll the dice' : `Dice showing ${target}`}
    >
      <div className="dice__cube" style={{ transform }}>
        {[1, 2, 3, 4, 5, 6].map((face) => {
          const color = faceColors?.[face - 1];
          const faceStyle = color ? ({ '--face': color } as CSSProperties) : undefined;
          return (
            <div
              key={face}
              className={`dice__face dice__face--${face}${color ? ' has-color' : ''}`}
              style={faceStyle}
            >
              {PIPS[face].map((cell) => (
                <span
                  key={cell}
                  className="dice__pip"
                  style={{ gridRow: Math.floor(cell / 3) + 1, gridColumn: (cell % 3) + 1 }}
                />
              ))}
            </div>
          );
        })}
      </div>
    </div>
  );
}
