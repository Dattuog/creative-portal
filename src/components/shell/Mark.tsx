/** The product's mark: a serum drop, drawn for this brand, in the brand hue. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <rect width="24" height="24" rx="6" fill="var(--chart-1)" />
      <path d="M12 5.2c2.6 3.2 4.3 5.6 4.3 7.9a4.3 4.3 0 0 1-8.6 0c0-2.3 1.7-4.7 4.3-7.9z" fill="#fff" />
      <path d="M10.3 13.6a1.9 1.9 0 0 0 1.7 1.7" stroke="var(--chart-1)" strokeWidth="1.2" fill="none" strokeLinecap="round" />
    </svg>
  );
}
