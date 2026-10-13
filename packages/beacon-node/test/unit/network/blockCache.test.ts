import {afterEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ResponseIncoming} from "@lodestar/reqresp";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockCache} from "../../../src/chain/blocks/blockCache.js";
import {Network} from "../../../src/network/network.js";
import {ClockStopped} from "../../mocks/clock.js";

describe("downloaded block cache", () => {
  afterEach(() => vi.restoreAllMocks());

  it.each(["range", "root", "head"])("preserves original bytes and decoded blocks for %s requests", async (method) => {
    const config = createChainForkConfig(chainConfig);
    const blockCache = new BlockCache(config);
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    const root = ssz.phase0.BeaconBlock.hashTreeRoot(block.message);
    const bytes = ssz.phase0.SignedBeaconBlock.serialize(block);
    const deserialize = vi.spyOn(ssz.phase0.SignedBeaconBlock, "deserialize");
    const hashTreeRoot = vi.spyOn(ssz.phase0.BeaconBlock, "hashTreeRoot");
    const network = {
      config,
      clock: new ClockStopped(0),
      chain: {blockCache},
      async *sendReqRespRequest(): AsyncGenerator<ResponseIncoming> {
        yield {data: bytes, fork: ForkName.phase0, protocolVersion: 2};
      },
    } as unknown as Network;

    const blocks =
      method === "range"
        ? await Network.prototype.sendBeaconBlocksByRange.call(network, "peer", {startSlot: 1, count: 1, step: 1})
        : method === "root"
          ? await Network.prototype.sendBeaconBlocksByRoot.call(network, "peer", [root])
          : await Network.prototype.sendBeaconBlocksByHead.call(network, "peer", {beaconRoot: root, count: 1});
    expect(blocks).toHaveLength(1);
    expect(ssz.phase0.SignedBeaconBlock.equals(blocks[0].block, block)).toBe(true);
    expect(blocks[0].block).toBe(deserialize.mock.results[0].value);
    expect(blocks[0].bytes).toBe(bytes);
    expect(blocks[0].block.signature.buffer).toBe(bytes.buffer);
    expect(blockCache.get(toRootHex(root))).toBeUndefined();
    expect(hashTreeRoot).not.toHaveBeenCalled();
    expect(deserialize).toHaveBeenCalledExactlyOnceWith(bytes, {reuseBytes: true});
  });
});
