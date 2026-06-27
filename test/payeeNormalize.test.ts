import { test } from "node:test";
import assert from "node:assert/strict";
import { normalizePayee, hasInvisibleChars } from "../src/core/payeeNormalize.ts";

const ZWSP = String.fromCodePoint(0x200b); // zero-width space
const RLO = String.fromCodePoint(0x202e); // right-to-left override
const CYR_A = String.fromCodePoint(0x0430); // Cyrillic 'а'
const CYR_O = String.fromCodePoint(0x043e); // Cyrillic 'о'

test("normalizePayee folds Cyrillic homoglyphs to ASCII", () => {
  assert.equal(normalizePayee(CYR_A + "cme"), "acme");
  assert.equal(normalizePayee("ACME"), "acme");
  assert.equal(normalizePayee("b" + CYR_A + "dact" + CYR_O + "r"), "badactor");
  // a homoglyph-spoofed payee collapses to the same key as the genuine one
  assert.equal(normalizePayee(CYR_A + "cme"), normalizePayee("acme"));
});

test("normalizePayee strips invisible characters", () => {
  assert.equal(normalizePayee("ac" + ZWSP + "me"), "acme");
  assert.equal(normalizePayee("  Tesco  "), "tesco");
});

test("hasInvisibleChars detects zero-width and BiDi controls, passes clean ids", () => {
  assert.equal(hasInvisibleChars("ac" + ZWSP + "me"), true);
  assert.equal(hasInvisibleChars("acme" + RLO), true);
  assert.equal(hasInvisibleChars("acme"), false);
  assert.equal(hasInvisibleChars("tesco-uk_01"), false);
  assert.equal(hasInvisibleChars("0xDEADBEEF"), false);
});
