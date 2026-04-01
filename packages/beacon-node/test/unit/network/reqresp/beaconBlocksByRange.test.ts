import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {mainnetChainConfig} from "@lodestar/config/configs";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {onBeaconBlocksByRange} from "../../../../src/network/reqresp/handlers/beaconBlocksByRange.js";

const config = createBeaconConfig(mainnetChainConfig, Buffer.alloc(32, 0xaa));

describe("beacon-node / network / reqresp / handlers / beaconBlocksByRange", () => {
  it("includes the finalized boundary block from hot storage when archive misses it", async () => {
    const finalizedBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    finalizedBlock.message.slot = 96;
    const finalizedRoot = toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(finalizedBlock.message));
    const finalizedBytes = ssz.phase0.SignedBeaconBlock.serialize(finalizedBlock);

    const childBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    childBlock.message.slot = 97;
    childBlock.message.parentRoot = ssz.phase0.BeaconBlock.hashTreeRoot(finalizedBlock.message);
    const childRoot = toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(childBlock.message));
    const childBytes = ssz.phase0.SignedBeaconBlock.serialize(childBlock);

    const serializedByRoot = new Map<string, {block: Uint8Array; executionOptimistic: boolean; finalized: boolean; slot: number}>([
      [finalizedRoot, {block: finalizedBytes, executionOptimistic: false, finalized: false, slot: 96}],
      [childRoot, {block: childBytes, executionOptimistic: false, finalized: false, slot: 97}],
    ]);

    const chain = {
      config,
      earliestAvailableSlot: 0,
      forkChoice: {
        getFinalizedBlock: () => ({slot: 96, blockRoot: finalizedRoot}),
        getHead: () => ({slot: 97, blockRoot: childRoot}),
        getAllAncestorBlocks: () => [{slot: 97, blockRoot: childRoot}],
      },
      getSerializedBlockByRoot: async (root: string) => serializedByRoot.get(root) ?? null,
      logger: {verbose: () => undefined},
    };

    const db = {
      blockArchive: {
        binaryEntriesStream: async function* () {
          // simulate archive transition gap: finalized slot 96 is not yet in cold db
        },
        decodeKey: (key: Uint8Array) => Number(Buffer.from(key).readBigUInt64BE()),
      },
    };

    const responses = [];
    for await (const response of onBeaconBlocksByRange(
      {startSlot: 96, count: 32, step: 1},
      chain as never,
      db as never,
      {} as never,
      "Lodestar"
    )) {
      responses.push(ssz.phase0.SignedBeaconBlock.deserialize(response.data).message.slot);
    }

    expect(responses).toEqual([96, 97]);
  });
});
