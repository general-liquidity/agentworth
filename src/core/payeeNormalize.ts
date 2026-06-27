// Payee-string canonicalization for deny-list / blocklist / known-payee matching.
//
// A raw payee identifier can be spoofed to dodge a security check two ways:
//   1. homoglyphs - "Acme" written with a Cyrillic "A" (U+0410) is a different
//      string to ASCII "Acme", so it slips a sanctioned-address deny rule or a
//      known-payee set;
//   2. invisible characters - a zero-width space or a BiDi override embedded in
//      the id changes the bytes while looking identical to a human.
//
// We canonicalize before matching, and separately flag payees carrying characters
// that have no legitimate place in an identifier. This is a deny/scrutiny input
// only - it can never relax the gate.

/** Code points with no legitimate place in a payee id: C0/C1 controls, soft
 *  hyphen, zero-width (space/joiner/non-joiner), LRM/RLM, BiDi embeddings +
 *  overrides, word-joiner / invisible operators, and the BOM / ZWNBSP. */
function isInvisibleCodePoint(cp: number): boolean {
  return (
    (cp >= 0x00 && cp <= 0x1f) || // C0 controls
    (cp >= 0x7f && cp <= 0x9f) || // DEL + C1 controls
    cp === 0x00ad || // soft hyphen
    (cp >= 0x200b && cp <= 0x200f) || // zero-width + LRM/RLM
    (cp >= 0x202a && cp <= 0x202e) || // BiDi embeddings + overrides
    (cp >= 0x2060 && cp <= 0x206f) || // word joiner / invisible operators
    cp === 0xfeff // BOM / zero-width no-break space
  );
}

// Minimal confusables fold: the common Cyrillic/Greek look-alikes used to spoof
// Latin identifiers (lowercase keys - we lowercase before folding). Not the full
// Unicode TR39 set, just the high-frequency spoofing characters.
const CONFUSABLES: Record<string, string> = {
  // Cyrillic -> Latin
  "а": "a",
  "е": "e",
  "о": "o",
  "р": "p",
  "с": "c",
  "у": "y",
  "х": "x",
  "ѕ": "s",
  "і": "i",
  "ј": "j",
  "ԁ": "d",
  "м": "m",
  "т": "t",
  "к": "k",
  "в": "b",
  "н": "h",
  // Greek -> Latin
  "ο": "o",
  "ρ": "p",
  "α": "a",
  "ε": "e",
  "ι": "i",
  "κ": "k",
  "ν": "v",
  "τ": "t",
  "υ": "u",
  "χ": "x",
  "β": "b",
};

/** True if the payee carries characters that have no legitimate place in an
 *  identifier (zero-width, BiDi override, control). A pure spoofing tell. */
export function hasInvisibleChars(payee: string): boolean {
  for (const ch of payee) {
    if (isInvisibleCodePoint(ch.codePointAt(0) ?? 0)) return true;
  }
  return false;
}

/** Canonical form for known-payee + blocklist matching: NFKC, lowercase, strip
 *  invisibles, fold common confusables to ASCII, trim. So a Cyrillic-spoofed
 *  "Acme", ASCII "acme", and a zero-width-injected payee all collapse to the
 *  same key. */
export function normalizePayee(payee: string): string {
  const lowered = payee.normalize("NFKC").toLowerCase();
  let out = "";
  for (const ch of lowered) {
    if (isInvisibleCodePoint(ch.codePointAt(0) ?? 0)) continue;
    out += CONFUSABLES[ch] ?? ch;
  }
  return out.trim();
}
