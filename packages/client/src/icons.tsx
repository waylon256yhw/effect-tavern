// The few glyphs the skeleton needs, hand-drawn on the old prototype's grid (24 viewbox, 1.7 stroke, round caps).
// ponytail: inline paths until the icon library is chosen (leaning Phosphor); swapping = replacing this file.
const I = ({ d }: { d: string }) => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
)
export const Swipe = () => <I d="M19 12a7 7 0 1 1-2.1-5M19 4v4h-4" />
export const Send = () => <I d="M12 19V6M6.5 11.5L12 6l5.5 5.5" />
export const Prev = () => <I d="M14 6l-6 6 6 6" />
export const Next = () => <I d="M10 6l6 6-6 6" />
export const Stop = () => (
  <svg viewBox="0 0 24 24" aria-hidden="true">
    <rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" />
  </svg>
)
