/**
 * Type-ahead for lists: the first enabled option after `from` (wrapping) whose label starts with
 * `text`, case-insensitively. Repeating one letter cycles through the options starting with it.
 * Returns -1 when nothing matches.
 */
export function nextTypeaheadIndex(options: ReadonlyArray<{ label: string; disabled?: boolean }>, text: string, from: number): number {
  const query = text.toLowerCase();
  const repeated = query.length > 1 && [...query].every((c) => c === query[0]);
  const needle = repeated ? query[0]! : query;
  // A longer query may still match the current option; a single (or repeated) letter moves on.
  const start = needle.length > 1 ? 0 : 1;
  for (let i = start; i < options.length + start; i++) {
    const index = (from + i) % options.length;
    const option = options[index]!;
    if (!option.disabled && option.label.toLowerCase().startsWith(needle)) return index;
  }
  return -1;
}
