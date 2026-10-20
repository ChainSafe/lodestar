import {afterEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ResponseIncoming} from "@lodestar/reqresp";
import {ssz} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {Network} from "../../../../src/network/network.js";
import {downloadByRange} from "../../../../src/sync/utils/downloadByRange.js";
import {fetchAndValidateBlock} from "../../../../src/sync/utils/downloadByRoot.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedBeaconChain} from "../../../mocks/mockedBeaconChain.js";

describe("downloaded block cache admission", () => {
  afterEach(() => vi.restoreAllMocks());

  for (const method of ["range", "root"] as const) {
    it.each(["new", "known", "finalized", "finalized boundary"])(
      `${method}: hashes once and caches only reusable blocks (%s)`,
      async (status) => {
        const config = createChainForkConfig(chainConfig);
        const chain = getMockedBeaconChain({config});
        const block = ssz.phase0.SignedBeaconBlock.defaultValue();
        block.message.slot = SLOTS_PER_EPOCH;
        const root = ssz.phase0.BeaconBlock.hashTreeRoot(block.message);
        const rootHex = toRootHex(root);
        const bytes = ssz.phase0.SignedBeaconBlock.serialize(block);
        const getFinalizedCheckpoint = vi
          .spyOn(chain, "getFinalizedCheckpoint")
          .mockReturnValue({epoch: 0, root, rootHex});
        const hasBlockHex = vi.spyOn(chain, "hasBlockHex").mockReturnValue(false);
        const hashTreeRoot = vi.spyOn(ssz.phase0.BeaconBlock, "hashTreeRoot");
        const deserialize = vi.spyOn(ssz.phase0.SignedBeaconBlock, "deserialize");
        const serialize = vi.spyOn(ssz.phase0.SignedBeaconBlock, "serialize");
        const network = {
          config,
          chain,
          clock: new ClockStopped(0),
          sendBeaconBlocksByRange: Network.prototype.sendBeaconBlocksByRange,
          sendBeaconBlocksByRoot: Network.prototype.sendBeaconBlocksByRoot,
          async *sendReqRespRequest(): AsyncGenerator<ResponseIncoming> {
            // Import or finalization can finish while the request is in flight.
            hasBlockHex.mockReturnValue(status === "known");
            getFinalizedCheckpoint.mockReturnValue({
              epoch: status === "finalized" ? 2 : status === "finalized boundary" ? 1 : 0,
              root,
              rootHex,
            });
            yield {data: bytes, fork: ForkName.phase0, protocolVersion: 2};
          },
        } as unknown as Network;

        if (method === "range") {
          await downloadByRange({
            config,
            chain,
            network,
            logger: chain.logger,
            peerIdStr: "peer",
            blocksRequest: {startSlot: block.message.slot, count: 1, step: 1},
          });
        } else {
          await fetchAndValidateBlock({config, chain, network, peerIdStr: "peer", blockRoot: root});
        }

        expect(hashTreeRoot).toHaveBeenCalledExactlyOnceWith(deserialize.mock.results[0].value.message);
        expect(deserialize).toHaveBeenCalledExactlyOnceWith(bytes, {reuseBytes: false});
        expect(serialize).not.toHaveBeenCalled();
        const entry = chain.blockSerializedCache.get(rootHex);
        if (status === "new") {
          expect(entry?.block).toBe(deserialize.mock.results[0].value);
          expect(entry?.bytes).toBe(bytes);
          expect(chain.blockSerializedCache.getOrDeserialize(rootHex, structuredClone(bytes))).toBe(entry);
          expect(deserialize).toHaveBeenCalledOnce();
        } else {
          expect(entry).toBeUndefined();
        }
      }
    );
  }

  it.each(["range", "root", "partial range"])("does not cache invalid or failed %s responses", async (method) => {
    const config = createChainForkConfig(chainConfig);
    const chain = getMockedBeaconChain({config});
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = 1;
    const root = ssz.phase0.BeaconBlock.hashTreeRoot(block.message);
    const bytes = ssz.phase0.SignedBeaconBlock.serialize(block);
    const nextBlock = ssz.phase0.SignedBeaconBlock.defaultValue();
    nextBlock.message.slot = 2;
    const nextBytes = ssz.phase0.SignedBeaconBlock.serialize(nextBlock);
    const set = vi.spyOn(chain.blockSerializedCache, "set");
    const network = {
      config,
      chain,
      clock: new ClockStopped(0),
      sendBeaconBlocksByRange: Network.prototype.sendBeaconBlocksByRange,
      sendBeaconBlocksByRoot: Network.prototype.sendBeaconBlocksByRoot,
      async *sendReqRespRequest(): AsyncGenerator<ResponseIncoming> {
        yield {data: bytes, fork: ForkName.phase0, protocolVersion: 2};
        if (method === "partial range") throw new Error("Request failed");
        yield {data: nextBytes, fork: ForkName.phase0, protocolVersion: 2};
      },
    } as unknown as Network;

    if (method === "root") {
      await expect(
        fetchAndValidateBlock({config, chain, network, peerIdStr: "peer", blockRoot: new Uint8Array(32)})
      ).rejects.toMatchObject({type: {code: "DOWNLOAD_BY_ROOT_ERROR_MISMATCH_BLOCK_ROOT"}});
    } else {
      await expect(
        downloadByRange({
          config,
          chain,
          network,
          logger: chain.logger,
          peerIdStr: "peer",
          blocksRequest: {startSlot: 1, count: 2, step: 1},
        })
      ).rejects.toMatchObject({
        type: {
          code:
            method === "range"
              ? "DOWNLOAD_BY_RANGE_ERROR_PARENT_ROOT_MISMATCH"
              : "DOWNLOAD_BY_RANGE_ERROR_REQ_RESP_ERROR",
        },
      });
    }
    expect(set).not.toHaveBeenCalled();
    expect(chain.blockSerializedCache.get(toRootHex(root))).toBeUndefined();
  });
});
