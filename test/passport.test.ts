import { test } from "node:test";
import assert from "node:assert/strict";

import {
  HUMAN_THRESHOLD,
  passportReputationOf,
  passportToReputationLevel,
  verifyPassport,
  type HumanPassportAttestation,
} from "../src/identity/passport.ts";

const ADDRESS = "0xAbC0000000000000000000000000000000000001";

function passport(over: Partial<HumanPassportAttestation> = {}): HumanPassportAttestation {
  return { scheme: "HumanPassport", address: ADDRESS, ...over };
}

test("passportToReputationLevel: threshold boundaries (default 20)", () => {
  assert.equal(passportToReputationLevel(25), "good"); // >= 20
  assert.equal(passportToReputationLevel(20), "good"); // exactly threshold
  assert.equal(passportToReputationLevel(15), "neutral"); // >= 10, < 20
  assert.equal(passportToReputationLevel(10), "neutral"); // exactly threshold/2
  assert.equal(passportToReputationLevel(5), "flagged"); // < 10
  assert.equal(passportToReputationLevel(0), "flagged");
});

test("passportToReputationLevel: undefined / NaN → unknown", () => {
  assert.equal(passportToReputationLevel(undefined), "unknown");
  assert.equal(passportToReputationLevel(Number.NaN), "unknown");
});

test("passportToReputationLevel: custom threshold rescales (0–100 Models API)", () => {
  assert.equal(passportToReputationLevel(50, 100), "neutral"); // >= 50 (threshold/2)
  assert.equal(passportToReputationLevel(100, 100), "good");
  assert.equal(passportToReputationLevel(40, 100), "flagged");
  assert.equal(HUMAN_THRESHOLD, 20);
});

test("verifyPassport: embedded score, no scorer", async () => {
  const res = await verifyPassport(passport({ score: 30 }));
  assert.equal(res.level, "good");
  assert.equal(res.score, 30);
  assert.equal(res.passing, true);
});

test("verifyPassport: embedded passing flag is respected", async () => {
  const res = await verifyPassport(passport({ score: 5, passing: false }));
  assert.equal(res.level, "flagged");
  assert.equal(res.passing, false);
});

test("verifyPassport: injected scorer overrides embedded score", async () => {
  const res = await verifyPassport(passport({ score: 5 }), {
    scorer: async (addr) => {
      assert.equal(addr, ADDRESS);
      return { score: 42, passing: true };
    },
  });
  assert.equal(res.level, "good");
  assert.equal(res.score, 42);
  assert.equal(res.passing, true);
});

test("verifyPassport: scorer threshold overrides the mapping threshold", async () => {
  const res = await verifyPassport(passport(), {
    scorer: async () => ({ score: 60, threshold: 100 }),
  });
  assert.equal(res.level, "neutral"); // 60 >= 50 (100/2) but < 100
  assert.equal(res.passing, false); // no passing flag, 60 < 100
});

test("verifyPassport: no score and no scorer → unknown", async () => {
  const res = await verifyPassport(passport());
  assert.equal(res.level, "unknown");
  assert.equal(res.passing, false);
});

test("passportReputationOf: returns the level for the attested address, unknown otherwise", async () => {
  const reputationOf = await passportReputationOf(passport({ score: 30 }));
  assert.equal(reputationOf(ADDRESS), "good");
  assert.equal(reputationOf(ADDRESS.toLowerCase()), "good"); // case-insensitive
  assert.equal(reputationOf("0x9999999999999999999999999999999999999999"), "unknown");
});

test("passportReputationOf: scorer-driven level", async () => {
  const reputationOf = await passportReputationOf(passport(), {
    scorer: async () => ({ score: 12 }),
  });
  assert.equal(reputationOf(ADDRESS), "neutral");
});
