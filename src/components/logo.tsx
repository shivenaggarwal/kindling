export function Logo({ size = 28, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden className={className}>
      <rect width="32" height="32" rx="8" fill="#1c1917" />
      <path d="M16 5c1.5 4 6 6.5 6 12a6 6 0 0 1-12 0c0-2.6 1.2-4.3 2.6-5.6.2 1.8 1 3 2.4 3.6-.6-3.4.2-6.6 1-10z" fill="#fb7537" />
      <path d="M16 15.5c.9 1.6 2.6 2.6 2.6 4.6a2.6 2.6 0 0 1-5.2 0c0-1.5.9-2.4 1.6-3 .1.8.4 1.3 1 1.6-.2-1.2 0-2.3 0-3.2z" fill="#fde9dd" />
    </svg>
  );
}
