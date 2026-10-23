import {beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {Root, ssz} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {toChainViewBlock} from "../../../../src/chain/beaconEngine/chainView.js";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {ReplicateChainView} from "../../../../src/chain/chainView/replicateChainView.js";
import {SerializedCache} from "../../../../src/util/serializedCache.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

const config = createBeaconConfig({}, Buffer.alloc(32));
const block = ssz.phase0.SignedBeaconBlock.defaultValue();
block.message.slot = 1;
const blockRoot = toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message));
const bytes = ssz.phase0.SignedBeaconBlock.serialize(block);
const anchor = toChainViewBlock(generateProtoBlock());
const head = toChainViewBlock(generateProtoBlock({blockRoot, slot: 1, parentRoot: anchor.blockRoot}));
const checkpoint = {epoch: 0, root: fromHex(anchor.blockRoot), rootHex: anchor.blockRoot};

describe("BeaconChain serialized block reads", () => {
  let chain: BeaconChain;
  const getBinary = vi.fn<(root: Root) => Promise<Uint8Array | null>>();
  const getBinaryEntryByRoot = vi.fn<(root: Root) => Promise<{key: number; value: Uint8Array} | null>>();

  beforeEach(() => {
    vi.resetAllMocks();
    getBinary.mockResolvedValue(null);
    getBinaryEntryByRoot.mockResolvedValue(null);
    chain = Object.assign(Object.create(BeaconChain.prototype) as BeaconChain, {
      config,
      beaconEngine: {
        chainView: new ReplicateChainView({
          blocks: [anchor, head],
          head,
          justified: checkpoint,
          finalized: checkpoint,
          version: 0,
        }),
      },
      seenBlockInputCache: {get: vi.fn(() => ({hasBlock: () => true, getBlock: () => block, slot: 1}))},
      serializedCache: new SerializedCache(),
      db: {block: {getBinary}, blockArchive: {getBinaryEntryByRoot}},
    });
  });

  it("serves cached blocks without BeaconEngine", async () => {
    expect(await chain.getSerializedBlockByRoot(fromHex(blockRoot))).toEqual({block: bytes, slot: 1});
    expect(chain.seenBlockInputCache.get).toHaveBeenCalledWith(blockRoot);
    expect(getBinary).not.toHaveBeenCalled();
    expect(getBinaryEntryByRoot).not.toHaveBeenCalled();
  });

  it("reuses serialized bytes from the cache", async () => {
    chain.serializedCache.set(block, bytes);
    expect((await chain.getSerializedBlockByRoot(fromHex(blockRoot)))?.block).toBe(bytes);
    expect(getBinary).not.toHaveBeenCalled();
  });

  it.each([false, true])("reads stored blocks on a cache miss (archived=%s)", async (archived) => {
    vi.mocked(chain.seenBlockInputCache.get).mockReturnValue(undefined);
    if (archived) getBinaryEntryByRoot.mockResolvedValue({key: 1, value: bytes});
    else getBinary.mockResolvedValue(bytes);
    expect(await chain.getSerializedBlockByRoot(fromHex(blockRoot))).toEqual({block: bytes, slot: 1});
    expect(getBinary).toHaveBeenCalledWith(fromHex(blockRoot));
    if (archived) expect(getBinaryEntryByRoot).toHaveBeenCalledWith(fromHex(blockRoot));
    else expect(getBinaryEntryByRoot).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    "retains stored-block fallback when ChainView has pruned metadata (archived=%s)",
    async (archived) => {
      vi.spyOn(chain.beaconEngine.chainView, "getBlockHexDefaultStatus").mockReturnValue(null);
      if (archived) getBinaryEntryByRoot.mockResolvedValue({key: 1, value: bytes});
      else getBinary.mockResolvedValue(bytes);
      expect(await chain.getSerializedBlockByRoot(fromHex(blockRoot))).toEqual({
        block: bytes,
        slot: 1,
      });
      expect(chain.seenBlockInputCache.get).not.toHaveBeenCalled();
    }
  );

  it("returns null when the block is unavailable", async () => {
    vi.mocked(chain.seenBlockInputCache.get).mockReturnValue(undefined);
    expect(await chain.getSerializedBlockByRoot(fromHex(blockRoot))).toBeNull();
  });
});
