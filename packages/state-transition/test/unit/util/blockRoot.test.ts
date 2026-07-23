import {describe, expect, it} from "vitest";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, GENESIS_EPOCH, GENESIS_SLOT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeCheckpointSlotAtEpoch, computeStartSlotAtEpoch} from "../../../src/util/index.js";

describe("computeCheckpointSlotAtEpoch", () => {
  const gloasForkEpoch = 4;
  const config = getConfig(ForkName.gloas, gloasForkEpoch);

  it("returns the genesis slot for the genesis epoch", () => {
    expect(computeCheckpointSlotAtEpoch(config, GENESIS_EPOCH)).toBe(GENESIS_SLOT);
  });

  it("uses the epoch start slot before EIP-8333 activation", () => {
    const epoch = gloasForkEpoch - 1;
    expect(computeCheckpointSlotAtEpoch(config, epoch)).toBe(computeStartSlotAtEpoch(epoch));
  });

  it("uses the previous slot at EIP-8333 activation and after", () => {
    expect(computeCheckpointSlotAtEpoch(config, gloasForkEpoch)).toBe(gloasForkEpoch * SLOTS_PER_EPOCH - 1);
    expect(computeCheckpointSlotAtEpoch(config, gloasForkEpoch + 1)).toBe((gloasForkEpoch + 1) * SLOTS_PER_EPOCH - 1);
  });
});
