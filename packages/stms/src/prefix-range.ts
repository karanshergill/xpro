export type PrefixRange = { lower: string; upper: string | null };
const maximumUnicodePoint = 0x10ffff;
const lastPointBeforeSurrogates = 0xd7ff;
const firstPointAfterSurrogates = 0xe000;

export function prefixRange(lower: string): PrefixRange {
  let stem = lower;
  for (const character of [...lower].reverse()) {
    stem = stem.slice(0, -character.length);
    const point = character.codePointAt(0);
    if (point !== undefined && point < maximumUnicodePoint) {
      const next = point === lastPointBeforeSurrogates ? firstPointAfterSurrogates : point + 1;
      return { lower, upper: stem + String.fromCodePoint(next) };
    }
  }
  return { lower, upper: null };
}
