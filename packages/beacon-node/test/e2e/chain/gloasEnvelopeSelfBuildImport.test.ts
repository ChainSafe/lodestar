import {afterEach, describe, expect, it, vi} from "vitest";
import {type ChainConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {type SignedBeaconBlock, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockInputSource} from "../../../src/chain/blocks/blockInput/types.js";
import {PayloadEnvelopeInput} from "../../../src/chain/blocks/payloadEnvelopeInput/payloadEnvelopeInput.js";
import {PayloadEnvelopeInputSource} from "../../../src/chain/blocks/payloadEnvelopeInput/types.js";
import {SyncState} from "../../../src/sync/interface.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";

async function waitUntil(predicate: () => boolean, timeoutMs: number, intervalMs = 250): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Condition not met within ${timeoutMs}ms`);
    }
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

describe("gloas self-build envelope import", () => {
  vi.setConfig({testTimeout: 180000});

  const validatorCount = 64;
  const SLOT_DURATION_MS = 2 * 1000;
  const testParams: Partial<ChainConfig> = {
    SLOT_DURATION_MS,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 1,
    BLOB_SCHEDULE: [{EPOCH: 0, MAX_BLOBS_PER_BLOCK: 3}],
  };

  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  it("imports a self-build Gloas envelope without state-transition error", async () => {
    const genesisSlotsDelay = 7;
    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * (SLOT_DURATION_MS / 1000);
    const bn = await getDevBeaconNode({
      params: testParams,
      options: {
        sync: {isSingleNode: true},
        api: {rest: {enabled: true, address: "127.0.0.1", port: 0}},
        network: {allowPublishToZeroPeers: true, mdns: true, useWorker: false},
        chain: {blsVerifyAllMainThread: true},
      },
      validatorCount,
      genesisTime,
    });
    afterEachCallbacks.push(async () => bn.close());

    const targetSlot = 2 * SLOTS_PER_EPOCH;
    await waitUntil(() => bn.chain.clock.currentSlot >= targetSlot, 120000);
    vi.spyOn(bn.sync, "state", "get").mockReturnValue(SyncState.Synced);

    const randaoReveal = new Uint8Array(96);
    const graffiti = "a".repeat(32);
    const {data: block} = await bn.api.validator.produceBlockV4({slot: targetSlot, randaoReveal, graffiti});

    const blockRoot = bn.config.getForkTypes(targetSlot).BeaconBlock.hashTreeRoot(block);
    const blockRootHex = toRootHex(blockRoot);

    const signedBlock = ssz.gloas.SignedBeaconBlock.defaultValue() as SignedBeaconBlock<typeof ForkName.gloas>;
    signedBlock.message = block as SignedBeaconBlock<typeof ForkName.gloas>["message"];

    const blockInput = bn.chain.seenBlockInputCache.getByBlock({
      block: signedBlock,
      blockRootHex,
      source: BlockInputSource.api,
      seenTimestampSec: Date.now() / 1000,
    });
    await bn.chain.processBlock(blockInput, {validSignatures: true});

    const {data: envelope} = await bn.api.validator.getExecutionPayloadEnvelope({
      slot: targetSlot,
      beaconBlockRoot: blockRoot,
    });
    expect(toRootHex(envelope.stateRoot)).not.toEqual("0x" + "00".repeat(32));

    const payloadInput = PayloadEnvelopeInput.createFromBlock({
      blockRootHex,
      block: signedBlock,
      forkName: ForkName.gloas,
      sampledColumns: [],
      custodyColumns: [],
      timeCreatedSec: Date.now() / 1000,
    });
    const signedEnvelope = ssz.gloas.SignedExecutionPayloadEnvelope.defaultValue();
    signedEnvelope.message = envelope;
    payloadInput.addPayloadEnvelope({
      envelope: signedEnvelope,
      source: PayloadEnvelopeInputSource.api,
      seenTimestampSec: Date.now() / 1000,
    });

    await expect(bn.chain.processExecutionPayload(payloadInput, {validSignature: true})).resolves.toBeUndefined();
  });
});
