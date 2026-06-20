import test from "node:test";
import assert from "node:assert/strict";
import { normalizeItemName } from "../scripts/data/item-grants.mjs";

test("normalizeItemName strips accents, case, and punctuation", () => {
  assert.equal(normalizeItemName("Aburame Clan"), "aburame clan");
  assert.equal(normalizeItemName("Ku'iarasu  Clan"), "kuiarasu clan");
  assert.equal(normalizeItemName("Crâne"), "crane");
  assert.equal(normalizeItemName(null), "");
});
