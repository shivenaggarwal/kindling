import { cn } from "@/lib/cn";

/**
 * Numbers drawn on a 5×7 LED dot matrix, the same grid as the logo.
 * Digits, currency and separators only; anything else is left out of the drawing
 * (the full value is always available to screen readers).
 */
const GLYPHS: Record<string, string[]> = {
  "0": [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "...#.", "..#..", ".#...", "#####"],
  "3": [".###.", "#...#", "....#", "..##.", "....#", "#...#", ".###."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": ["..##.", ".#...", "#....", "####.", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "..#..", ".#...", ".#...", ".#..."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", ".####", "....#", "...#.", ".##.."],
  $: ["..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."],
  "%": ["##...", "##..#", "...#.", "..#..", ".#...", "#..##", "...##"],
  ".": [".", ".", ".", ".", ".", ".", "#"],
  ",": [".", ".", ".", ".", ".", "#", "#"],
  "-": ["...", "...", "...", "###", "...", "...", "..."],
  "–": ["...", "...", "...", "###", "...", "...", "..."],
  " ": ["..", "..", "..", "..", "..", "..", ".."],
};

export function MatrixNumber({ value, size = 28, className }: { value: string | number; size?: number; className?: string }) {
  const text = String(value);
  const glyphs = [...text].map((c) => GLYPHS[c]).filter(Boolean);
  const dots: { x: number; y: number }[] = [];
  let x = 0;
  glyphs.forEach((g, i) => {
    g.forEach((row, y) => [...row].forEach((c, cx) => c === "#" && dots.push({ x: x + cx, y })));
    x += g[0].length + (i < glyphs.length - 1 ? 1 : 0);
  });
  const cell = size / 7;
  return (
    <span className={cn("inline-flex items-end", className)}>
      <svg width={Math.max(1, x) * cell} height={size} viewBox={`0 0 ${Math.max(1, x)} 7`} aria-hidden className="block overflow-visible">
        {dots.map((d) => (
          <circle key={`${d.x}-${d.y}`} cx={d.x + 0.5} cy={d.y + 0.5} r={0.43} fill="currentColor" />
        ))}
      </svg>
      <span className="sr-only">{text}</span>
    </span>
  );
}
