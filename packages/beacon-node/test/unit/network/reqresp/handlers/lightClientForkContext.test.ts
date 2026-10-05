import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH, ZERO_HASH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {IBeaconChain} from "../../../../../src/chain/index.js";
import {GossipType} from "../../../../../src/network/gossip/interface.js";
import {stringifyGossipTopic} from "../../../../../src/network/gossip/topic.js";
import {Network} from "../../../../../src/network/network.js";
import {onLightClientFinalityUpdate} from "../../../../../src/network/reqresp/handlers/lightClientFinalityUpdate.js";
import {onLightClientOptimisticUpdate} from "../../../../../src/network/reqresp/handlers/lightClientOptimisticUpdate.js";
import {onLightClientUpdatesByRange} from "../../../../../src/network/reqresp/handlers/lightClientUpdatesByRange.js";

const reqRespConfig = createChainForkConfig({
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  CAPELLA_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 1,
});
const reqRespAttestedSlot = SLOTS_PER_EPOCH - 1;
const reqRespSignatureSlot = SLOTS_PER_EPOCH;

const gossipConfig = createBeaconConfig(
  {
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 1,
  },
  ZERO_HASH
);
const gossipAttestedSlot = SLOTS_PER_EPOCH - 1;
const gossipSignatureSlot = SLOTS_PER_EPOCH;

type PublishedGossip = {topic: string; data: Uint8Array};

function createChain(): IBeaconChain {
  const update = ssz.capella.LightClientUpdate.defaultValue();
  update.attestedHeader.beacon.slot = reqRespAttestedSlot;
  update.signatureSlot = reqRespSignatureSlot;

  const finalityUpdate = ssz.capella.LightClientFinalityUpdate.defaultValue();
  finalityUpdate.attestedHeader.beacon.slot = reqRespAttestedSlot;
  finalityUpdate.signatureSlot = reqRespSignatureSlot;

  const optimisticUpdate = ssz.capella.LightClientOptimisticUpdate.defaultValue();
  optimisticUpdate.attestedHeader.beacon.slot = reqRespAttestedSlot;
  optimisticUpdate.signatureSlot = reqRespSignatureSlot;

  return {
    config: reqRespConfig,
    lightClientServer: {
      getUpdate: async () => update,
      getFinalityUpdate: () => finalityUpdate,
      getOptimisticUpdate: () => optimisticUpdate,
    },
  } as unknown as IBeaconChain;
}

function createNetwork(published: PublishedGossip[]): Network {
  return Object.assign(Object.create(Network.prototype), {
    config: gossipConfig,
    core: {
      publishGossip: vi.fn(async (topic: string, data: Uint8Array) => {
        published.push({topic, data});
        return 1;
      }),
    },
    logger: {verbose: vi.fn()},
    clock: {currentSlot: gossipSignatureSlot},
  }) as Network;
}

describe("light client fork context", () => {
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

  it("publishes a pre-Gloas finality update with the attested header fork context", async () => {
    const update = ssz.fulu.LightClientFinalityUpdate.defaultValue();
    update.attestedHeader.beacon.slot = gossipAttestedSlot;
    update.signatureSlot = gossipSignatureSlot;
    const published: PublishedGossip[] = [];

    await createNetwork(published).publishLightClientFinalityUpdate(update);

    expect(published).toHaveLength(1);
    expect(published[0].topic).toBe(
      stringifyGossipTopic(gossipConfig, {
        type: GossipType.light_client_finality_update,
        boundary: {fork: ForkName.fulu, epoch: gossipConfig.FULU_FORK_EPOCH},
      })
    );
    expect(() => ssz.fulu.LightClientFinalityUpdate.deserialize(published[0].data)).not.toThrow();
  });

  it("publishes a pre-Gloas optimistic update with the attested header fork context", async () => {
    const update = ssz.fulu.LightClientOptimisticUpdate.defaultValue();
    update.attestedHeader.beacon.slot = gossipAttestedSlot;
    update.signatureSlot = gossipSignatureSlot;
    const published: PublishedGossip[] = [];

    await createNetwork(published).publishLightClientOptimisticUpdate(update);

    expect(published).toHaveLength(1);
    expect(published[0].topic).toBe(
      stringifyGossipTopic(gossipConfig, {
        type: GossipType.light_client_optimistic_update,
        boundary: {fork: ForkName.fulu, epoch: gossipConfig.FULU_FORK_EPOCH},
      })
    );
    expect(() => ssz.fulu.LightClientOptimisticUpdate.deserialize(published[0].data)).not.toThrow();
  });
});
