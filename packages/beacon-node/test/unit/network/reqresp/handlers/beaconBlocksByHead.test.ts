import {PeerId} from "@libp2p/interface";
import {describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {RespStatus} from "@lodestar/reqresp";
import {computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {SignedBeaconBlock, ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {IBeaconChain} from "../../../../../src/chain/index.js";
import {ZERO_HASH} from "../../../../../src/constants/index.js";
import {onBeaconBlocksByHead} from "../../../../../src/network/reqresp/handlers/beaconBlocksByHead.js";
import {ReqRespMethod, Version, responseSszTypeByMethod} from "../../../../../src/network/reqresp/types.js";
import {getSlotFromSignedBeaconBlockSerialized} from "../../../../../src/util/sszBytes.js";

const config = createBeaconConfig(
  {
    ...chainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    MIN_EPOCHS_FOR_BLOCK_REQUESTS: 1,
  },
  ZERO_HASH
);
const crossForkConfig = createBeaconConfig(
  {
    ...chainConfig,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 2,
    MIN_EPOCHS_FOR_BLOCK_REQUESTS: 1,
  },
  ZERO_HASH
);
const peerId = {toString: () => "test-peer"} as PeerId;

describe("onBeaconBlocksByHead", () => {
  it("returns blocks from head to ancestors in descending slot order", async () => {
    const blocks = createBlocks([10, 11, 12]);
    const chain = createChain(blocks);

    const responses = await Array.fromAsync(
      onBeaconBlocksByHead({beaconRoot: blocks[2].root, count: 2}, chain, peerId, "test-client")
    );

    expect(responses.map((response) => getSlotFromSignedBeaconBlockSerialized(response.data))).toEqual([12, 11]);
    expect(responses.map((response) => response.boundary.fork)).toEqual([ForkName.fulu, ForkName.fulu]);
    expect(responses.map((response) => response.data)).toEqual([blocks[2].bytes, blocks[1].bytes]);
  });

  it("stops before ancestors older than the minimum request epoch", async () => {
    const currentEpoch = 5;
    const minimumRequestSlot = computeStartSlotAtEpoch(currentEpoch - config.MIN_EPOCHS_FOR_BLOCK_REQUESTS);
    const blocks = createBlocks([minimumRequestSlot - 1, minimumRequestSlot, minimumRequestSlot + 1]);
    const chain = createChain(blocks, currentEpoch);

    const responses = await Array.fromAsync(
      onBeaconBlocksByHead({beaconRoot: blocks[2].root, count: 3}, chain, peerId, "test-client")
    );

    expect(responses.map((response) => getSlotFromSignedBeaconBlockSerialized(response.data))).toEqual([
      minimumRequestSlot + 1,
      minimumRequestSlot,
    ]);
  });

  it("continues across the Fulu fork boundary", async () => {
    const fuluStartSlot = computeStartSlotAtEpoch(crossForkConfig.FULU_FORK_EPOCH);
    const blocks = createBlocks([fuluStartSlot - 1, fuluStartSlot], crossForkConfig);
    const chain = createChain(blocks, crossForkConfig.FULU_FORK_EPOCH, crossForkConfig);

    const responses = await Array.fromAsync(
      onBeaconBlocksByHead({beaconRoot: blocks[1].root, count: 2}, chain, peerId, "test-client")
    );

    expect(responses.map((response) => getSlotFromSignedBeaconBlockSerialized(response.data))).toEqual([
      fuluStartSlot,
      fuluStartSlot - 1,
    ]);
    expect(responses.map((response) => response.boundary.fork)).toEqual([ForkName.fulu, ForkName.electra]);
  });

  it("caps responses to MAX_REQUEST_BLOCKS_DENEB", async () => {
    const blocks = createBlocks(Array.from({length: config.MAX_REQUEST_BLOCKS_DENEB + 2}, (_, i) => i + 1));
    const chain = createChain(blocks);
    const head = blocks.at(-1);
    if (!head) {
      throw Error("Expected at least one block");
    }

    const responses = await Array.fromAsync(
      onBeaconBlocksByHead(
        {beaconRoot: head.root, count: config.MAX_REQUEST_BLOCKS_DENEB + 10},
        chain,
        peerId,
        "test-client"
      )
    );

    expect(responses).toHaveLength(config.MAX_REQUEST_BLOCKS_DENEB);
  });

  it("returns no blocks when the requested root is older than the minimum request epoch", async () => {
    const currentEpoch = 5;
    const minimumRequestSlot = computeStartSlotAtEpoch(currentEpoch - config.MIN_EPOCHS_FOR_BLOCK_REQUESTS);
    const blocks = createBlocks([minimumRequestSlot - 1, minimumRequestSlot, minimumRequestSlot + 1]);
    const chain = createChain(blocks, currentEpoch);

    const responses = await Array.fromAsync(
      onBeaconBlocksByHead({beaconRoot: blocks[0].root, count: 1}, chain, peerId, "test-client")
    );

    expect(responses).toEqual([]);
    expect(chain.logger.verbose).toHaveBeenCalledOnce();
  });

  it("allows zero-count requests", async () => {
    const blocks = createBlocks([10]);
    const chain = createChain(blocks);

    const responses = await Array.fromAsync(
      onBeaconBlocksByHead({beaconRoot: blocks[0].root, count: 0}, chain, peerId, "test-client")
    );

    expect(responses).toEqual([]);
    expect(chain.getSerializedBlockByRoot).not.toHaveBeenCalled();
  });

  it("returns ResourceUnavailable when the requested root is unknown", async () => {
    const blocks = createBlocks([10]);
    const chain = createChain(blocks);
    const unknownRoot = new Uint8Array(32).fill(0xab);

    await expect(
      Array.fromAsync(onBeaconBlocksByHead({beaconRoot: unknownRoot, count: 1}, chain, peerId, "test-client"))
    ).rejects.toMatchObject({status: RespStatus.RESOURCE_UNAVAILABLE});
  });

  it("decodes BlocksByHead responses with the block fork type", () => {
    expect(responseSszTypeByMethod[ReqRespMethod.BeaconBlocksByHead](ForkName.electra, Version.V1)).toBe(
      ssz.electra.SignedBeaconBlock
    );
    expect(responseSszTypeByMethod[ReqRespMethod.BeaconBlocksByHead](ForkName.fulu, Version.V1)).toBe(
      ssz.fulu.SignedBeaconBlock
    );
  });
});

type TestBlock = {
  block: SignedBeaconBlock;
  bytes: Uint8Array;
  root: Uint8Array;
  rootHex: string;
  slot: number;
};

function createBlocks(slots: number[], testConfig = config): TestBlock[] {
  let parentRoot: Uint8Array = ZERO_HASH;
  const blocks: TestBlock[] = [];

  for (const slot of slots) {
    const forkTypes = testConfig.getForkTypes(slot);
    const block = forkTypes.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.parentRoot = parentRoot;

    const root = forkTypes.BeaconBlock.hashTreeRoot(block.message);
    blocks.push({
      block,
      bytes: forkTypes.SignedBeaconBlock.serialize(block),
      root,
      rootHex: toRootHex(root),
      slot,
    });
    parentRoot = root;
  }

  return blocks;
}

function createChain(blocks: TestBlock[], currentEpoch = 0, testConfig = config): IBeaconChain {
  const blocksByRoot = new Map(blocks.map((block) => [block.rootHex, block]));

  return {
    config: testConfig,
    clock: {currentEpoch},
    getSerializedBlockByRoot: vi.fn(async (rootHex: string) => {
      const block = blocksByRoot.get(rootHex);
      return block ? {block: block.bytes, executionOptimistic: false, finalized: false, slot: block.slot} : null;
    }),
    logger: {verbose: vi.fn()},
  } as unknown as IBeaconChain;
}
