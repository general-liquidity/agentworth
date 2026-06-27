import { test } from "node:test";
import assert from "node:assert/strict";
import { convertMinorCrossDecimal, minorUnitExponent } from "../src/core/fx.ts";

test("minorUnitExponent prefers injected token decimals over ISO + default", () => {
  assert.equal(minorUnitExponent("USDC", { USDC: 6 }), 6);
  assert.equal(minorUnitExponent("DAI", { DAI: 18 }), 18);
  assert.equal(minorUnitExponent("JPY"), 0); // ISO fiat
  assert.equal(minorUnitExponent("GBP"), 2); // default
  // an unknown token with no map falls back to 2 (the gap the injection closes)
  assert.equal(minorUnitExponent("USDC"), 2);
});

test("convertMinorCrossDecimal scales a 6-decimal token against a 2-decimal mandate", () => {
  const decimals = { USDC: 6 };
  // 5 USDC (= 5_000_000 base units) at 0.79 GBP/USDC -> 3.95 GBP = 395 pence.
  assert.equal(convertMinorCrossDecimal(5_000_000, 0.79, "USDC", "GBP", decimals), 395);
  // Without the token-decimals map it mis-scales by 10^4 — why the injection matters.
  assert.notEqual(convertMinorCrossDecimal(5_000_000, 0.79, "USDC", "GBP"), 395);
});
