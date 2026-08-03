import {describe, expect, it} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {IBeaconChain} from "../../../../../src/chain/index.js";
import {onLightClientFinalityUpdate} from "../../../../../src/network/reqresp/handlers/lightClientFinalityUpdate.js";
import {onLightClientOptimisticUpdate} from "../../../../../src/network/reqresp/handlers/lightClientOptimisticUpdate.js";
import {onLightClientUpdatesByRange} from "../../../../../src/network/reqresp/handlers/lightClientUpdatesByRange.js";

const config = createChainForkConfig({
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  CAPELLA_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 1,
});
const attestedSlot = SLOTS_PER_EPOCH - 1;
const signatureSlot = SLOTS_PER_EPOCH;

function createChain(): IBeaconChain {
  const update = ssz.capella.LightClientUpdate.defaultValue();
  update.attestedHeader.beacon.slot = attestedSlot;
  update.signatureSlot = signatureSlot;

  const finalityUpdate = ssz.capella.LightClientFinalityUpdate.defaultValue();
  finalityUpdate.attestedHeader.beacon.slot = attestedSlot;
  finalityUpdate.signatureSlot = signatureSlot;

  const optimisticUpdate = ssz.capella.LightClientOptimisticUpdate.defaultValue();
  optimisticUpdate.attestedHeader.beacon.slot = attestedSlot;
  optimisticUpdate.signatureSlot = signatureSlot;

  return {
    config,
    lightClientServer: {
      getUpdate: async () => update,
      getFinalityUpdate: () => finalityUpdate,
      getOptimisticUpdate: () => optimisticUpdate,
    },
  } as unknown as IBeaconChain;
}

describe("light client Req/Resp fork context", () => {
  it("uses the attested header fork for updates by range", async () => {
    const [response] = await Array.fromAsync(onLightClientUpdatesByRange({startPeriod: 0, count: 1}, createChain()));

    expect(response.boundary.fork).toBe(ForkName.capella);
  });

  it("uses the attested header fork for finality updates", async () => {
    const [response] = await Array.fromAsync(onLightClientFinalityUpdate(createChain()));

    expect(response.boundary.fork).toBe(ForkName.capella);
  });

  it("uses the attested header fork for optimistic updates", async () => {
    const [response] = await Array.fromAsync(onLightClientOptimisticUpdate(createChain()));

    expect(response.boundary.fork).toBe(ForkName.capella);
  });
});
