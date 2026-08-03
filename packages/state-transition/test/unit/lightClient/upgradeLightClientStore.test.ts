import {describe, expect, it} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {LightClientUpdate, ssz} from "@lodestar/types";
import {
  ILightClientStore,
  toLightClientUpdateSummary,
  upgradeLightClientStore,
} from "../../../src/lightClient/spec/index.js";

const config = createChainForkConfig({
  ...defaultChainConfig,
  ALTAIR_FORK_EPOCH: 1,
  BELLATRIX_FORK_EPOCH: 2,
  CAPELLA_FORK_EPOCH: 3,
  DENEB_FORK_EPOCH: 4,
  ELECTRA_FORK_EPOCH: 5,
  FULU_FORK_EPOCH: 6,
  GLOAS_FORK_EPOCH: 7,
});
const fuluSlot = 6 * SLOTS_PER_EPOCH;

function createFuluUpdate(slot: number): LightClientUpdate {
  const update = ssz.fulu.LightClientUpdate.defaultValue();
  update.attestedHeader.beacon.slot = slot;
  update.finalizedHeader.beacon.slot = slot;
  update.signatureSlot = slot + 1;
  return update;
}

describe("upgradeLightClientStore", () => {
  it("upgrades every cached best update", () => {
    const updates = new Map([
      [0, createFuluUpdate(fuluSlot)],
      [1, createFuluUpdate(fuluSlot + 1)],
    ]);
    const bestValidUpdates = new Map(
      Array.from(updates, ([period, update]) => [period, {update, summary: toLightClientUpdateSummary(update)}])
    );
    const summaries = new Map(Array.from(bestValidUpdates, ([period, value]) => [period, value.summary]));
    const finalizedHeader = ssz.fulu.LightClientHeader.defaultValue();
    finalizedHeader.beacon.slot = fuluSlot;
    const optimisticHeader = ssz.fulu.LightClientHeader.defaultValue();
    optimisticHeader.beacon.slot = fuluSlot + 1;
    const store = {
      bestValidUpdates,
      finalizedHeader,
      optimisticHeader,
    } as unknown as ILightClientStore;

    upgradeLightClientStore(config, ForkName.gloas, store);

    expect(store.bestValidUpdates.size).toBe(2);
    for (const [period, bestValidUpdate] of store.bestValidUpdates) {
      expect(bestValidUpdate.update.attestedHeader).toHaveProperty("executionBlockHash");
      expect(bestValidUpdate.update.attestedHeader).not.toHaveProperty("execution");
      expect(bestValidUpdate.update.finalizedHeader).toHaveProperty("executionBlockHash");
      expect(bestValidUpdate.update.finalizedHeader).not.toHaveProperty("execution");
      expect(bestValidUpdate.summary).toBe(summaries.get(period));
    }
  });
});
