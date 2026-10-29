/**
 * Where an arrow key moves in a radio-style segmented control: ← ↑ to the previous segment, → ↓ to
 * the next (wrapping round), Home and End to the ends, skipping disabled ones. Null for any other
 * key, or when nothing can be chosen.
 */
export function stepSegment(key: string, current: number, enabled: readonly boolean[]): number | null {
  const choices = enabled.flatMap((on, i) => (on ? [i] : []));
  if (choices.length === 0) return null;
  if (key === 'Home') return choices[0]!;
  if (key === 'End') return choices[choices.length - 1]!;
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
  if (!step) return null;
  const at = choices.indexOf(current);
  // From nothing chosen (or a disabled one), the first step lands on an end.
  if (at === -1) return step > 0 ? choices[0]! : choices[choices.length - 1]!;
  return choices[(at + step + choices.length) % choices.length]!;
}
