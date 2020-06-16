import {assert} from "chai";

import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";import { computeSlotsSinceEpochStart } from "../../../../src/util";
import {Slot} from "@chainsafe/lodestar-types";


describe("computeSlotsSinceEpochStart", () => {
  const pairs = [
    {test: 0n, expected: 0n},
    {test: 5n, expected: 5n},
    {test: 40n, expected: 8n},
    {test: 50n, expected: 18n},
  ];

  for (const pair of pairs) {
    it(`Slot ${pair.test} is ${pair.expected} from current Epoch start`, () => {
      const result: Slot = computeSlotsSinceEpochStart(config, pair.test);
      assert.equal(result, pair.expected);
    });
  }

  it("should compute slot correctly since a specified epoch", () => {
    const epoch = 1n;
    const slot = 70n;
    const result = computeSlotsSinceEpochStart(config, slot, epoch);
    // 70 - NUM_SLOT_PER_EPOCH
    assert.equal(result, 38);
  });
});