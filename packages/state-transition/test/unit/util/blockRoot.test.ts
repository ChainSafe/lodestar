import {describe, expect, it} from "vitest";
import {getConfig} from "@lodestar/config/test-utils";
import {ForkName, GENESIS_EPOCH, GENESIS_SLOT, SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeCheckpointSlotAtEpoch, computeStartSlotAtEpoch} from "../../../src/util/index.js";

describe("computeCheckpointSlotAtEpoch", () => {
  const hezeForkEpoch = 4;
  const gloasConfig = getConfig(ForkName.gloas, hezeForkEpoch);
  const hezeConfig = getConfig(ForkName.heze, hezeForkEpoch);

  it("returns the genesis slot for the genesis epoch", () => {
    expect(computeCheckpointSlotAtEpoch(hezeConfig, GENESIS_EPOCH)).toBe(GENESIS_SLOT);
  });

  it("uses the epoch start slot before EIP-8333 activation", () => {
    const epoch = hezeForkEpoch - 1;
    expect(computeCheckpointSlotAtEpoch(hezeConfig, epoch)).toBe(computeStartSlotAtEpoch(epoch));
  });

  it("keeps Gloas checkpoint roots at the epoch start", () => {
    expect(computeCheckpointSlotAtEpoch(gloasConfig, hezeForkEpoch)).toBe(computeStartSlotAtEpoch(hezeForkEpoch));
  });

  it("uses the previous slot at EIP-8333 activation and after", () => {
    expect(computeCheckpointSlotAtEpoch(hezeConfig, hezeForkEpoch)).toBe(hezeForkEpoch * SLOTS_PER_EPOCH - 1);
    expect(computeCheckpointSlotAtEpoch(hezeConfig, hezeForkEpoch + 1)).toBe((hezeForkEpoch + 1) * SLOTS_PER_EPOCH - 1);
  });
});
