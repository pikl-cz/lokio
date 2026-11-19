const MARKS = /\p{M}+/gu;
const SEPARATOR = /[^\p{L}\p{N}]+/u;

/** Lowercases and strips diacritics, so "Kůň" and "kun" compare equal. */
export function fold(text: string): string {
  return text.normalize("NFD").replace(MARKS, "").toLowerCase();
}

/** Splits text into folded word tokens. */
export function tokenize(text: string): string[] {
  return fold(text).split(SEPARATOR).filter(Boolean);
}

/**
 * Folds `text` code point by code point and remembers, for every folded
 * character, the index of the original character it came from. Lets us find
 * a match in folded text and cut the snippet from the original.
 */
export function foldWithMap(text: string): { folded: string; map: number[] } {
  let folded = "";
  const map: number[] = [];
  let index = 0;
  for (const char of text) {
    const part = fold(char);
    for (let i = 0; i < part.length; i++) map.push(index);
    folded += part;
    index += char.length;
  }
  map.push(index);
  return { folded, map };
}
