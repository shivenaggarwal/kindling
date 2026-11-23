import { APP_NAME } from "@/lib/config";
import { cn } from "@/lib/cn";

/**
 * The mark: a spark drawn on a 5×6 LED matrix. Lit dots are ink, the core is
 * the ember signal, unlit dots stay faintly visible like an unpowered panel.
 */
const MATRIX = [
  "..#..",
  ".##..",
  ".###.",
  "##*##",
  "#***#",
  ".###.",
];

export function Logo({ size = 24, className, grid = true, boot = false }: { size?: number; className?: string; grid?: boolean; boot?: boolean }) {
  const cell = 6;
  const w = MATRIX[0].length * cell;
  const h = MATRIX.length * cell;
  let i = 0;
  return (
    <svg width={(size * w) / h} height={size} viewBox={`0 0 ${w} ${h}`} aria-hidden className={cn(boot && "dot-boot", className)}>
      {MATRIX.flatMap((row, y) =>
        [...row].map((c, x) => {
          const on = c !== ".";
          if (!on && !grid) return null;
          const order = on ? i++ : 0;
          return (
            <circle
              key={`${x}-${y}`}
              cx={x * cell + cell / 2}
              cy={y * cell + cell / 2}
              r={2.35}
              fill={c === "*" ? "var(--signal)" : on ? "currentColor" : "var(--dot-off)"}
              data-on={on ? "" : undefined}
              style={on ? ({ "--i": order } as React.CSSProperties) : undefined}
            />
          );
        }),
      )}
    </svg>
  );
}

export function Wordmark({ className }: { className?: string }) {
  return <span className={cn("font-dot font-extrabold lowercase leading-none tracking-[0.02em]", className)}>{APP_NAME}</span>;
}
