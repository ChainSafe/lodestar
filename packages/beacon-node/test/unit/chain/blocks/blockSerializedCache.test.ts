import {afterEach, describe, expect, it, vi} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ssz, sszTypesFor} from "@lodestar/types";
import {BlockSerializedCache} from "../../../../src/chain/blocks/blockSerializedCache.js";
import {computeSignedBlockRoot, toSignedBlockRootHex} from "../../../../src/chain/blocks/signedBlockRoot.js";
import {createLodestarMetrics} from "../../../../src/metrics/metrics/lodestar.js";
import {RegistryMetricCreator} from "../../../../src/metrics/utils/registryMetricCreator.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

describe("BlockSerializedCache", () => {
  const config = createChainForkConfig(chainConfig);
  afterEach(() => vi.restoreAllMocks());

  function candidate(slot = 1, signature = 0) {
    const block = ssz.phase0.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.signature.fill(signature);
    const blockRoot = ssz.phase0.BeaconBlock.hashTreeRoot(block.message);
    return {
      block,
      bytes: ssz.phase0.SignedBeaconBlock.serialize(block),
      blockRoot,
      signedBlockRoot: computeSignedBlockRoot(ForkName.phase0, block),
      root: toSignedBlockRootHex(computeSignedBlockRoot(ForkName.phase0, block)),
    };
  }

  it("reuses an existing signed candidate and original bytes without decoding", () => {
    const cache = new BlockSerializedCache(config);
    const {block, bytes, root, signedBlockRoot} = candidate();
    const entry = cache.set(root, block, bytes);
    const deserialize = vi.spyOn(ssz.phase0.SignedBeaconBlock, "deserialize");
    expect(cache.getOrDeserialize(signedBlockRoot, bytes)).toBe(entry);
    expect(cache.getOrSerialize(root, block)).toBe(entry);
    expect(cache.set(root, ssz.phase0.SignedBeaconBlock.clone(block), structuredClone(bytes))).toBe(entry);
    expect(entry.block).toBe(block);
    expect(entry.bytes).toBe(bytes);
    expect(deserialize).not.toHaveBeenCalled();
  });

  it("decodes once and reuses the signed candidate for cloned bytes", () => {
    const cache = new BlockSerializedCache(config);
    const {block, bytes, signedBlockRoot} = candidate();
    const deserialize = vi.spyOn(ssz.phase0.SignedBeaconBlock, "deserialize");
    const entry = cache.getOrDeserialize(signedBlockRoot, bytes);
    expect(entry.block).toEqual(block);
    expect(entry.block.signature.buffer).not.toBe(bytes.buffer);
    expect(deserialize).toHaveBeenCalledExactlyOnceWith(bytes, {reuseBytes: false});
    const clonedBytes = structuredClone(bytes);
    expect(cache.getOrDeserialize(signedBlockRoot, clonedBytes)).toBe(entry);
    expect(deserialize).toHaveBeenCalledTimes(1);
  });

  it.each([ForkName.phase0, ForkName.electra, ForkName.fulu])(
    "preserves %s block bytes containing non-byte-aligned aggregation bits",
    (fork) => {
      const types = sszTypesFor(fork);
      const block = types.SignedBeaconBlock.defaultValue();
      const attestation = types.Attestation.defaultValue();
      attestation.aggregationBits = BitArray.fromSingleBit(9, 8);
      block.message.body.attestations = [attestation];
      const bytes = types.SignedBeaconBlock.serialize(block);
      const originalBytes = Uint8Array.from(bytes);
      const root = computeSignedBlockRoot(fork, block);
      const cache = new BlockSerializedCache(config);

      const entry = cache.getOrDeserialize(root, bytes, fork);

      expect(types.SignedBeaconBlock.equals(entry.block, block)).toBe(true);
      expect(bytes).toEqual(originalBytes);
      expect(entry.bytes).toBe(bytes);
      expect(types.SignedBeaconBlock.equals(types.SignedBeaconBlock.deserialize(entry.bytes), block)).toBe(true);
      entry.block.message.body.attestations[0].aggregationBits.set(0, true);
      expect(bytes).toEqual(originalBytes);
    }
  );

  it("retains independent signatures for the same block root and deletes only the rejected candidate", () => {
    const cache = new BlockSerializedCache(config);
    const original = candidate();
    const replacement = candidate(1, 1);
    expect(replacement.blockRoot).toEqual(original.blockRoot);
    expect(replacement.root).not.toBe(original.root);
    const originalEntry = cache.set(original.root, original.block, original.bytes);
    const entry = cache.getOrDeserialize(replacement.signedBlockRoot, replacement.bytes);
    expect(entry.block.signature).toEqual(replacement.block.signature);
    expect(entry.bytes).toBe(replacement.bytes);
    expect(cache.get(original.root)).toBe(originalEntry);
    expect(cache.get(replacement.root)).toBe(entry);
    cache.delete(replacement.root, entry.block, "rejected");
    expect(cache.get(replacement.root)).toBeUndefined();
    expect(cache.get(original.root)).toBe(originalEntry);
  });

  it("serializes a different signature instead of returning stale bytes", () => {
    const cache = new BlockSerializedCache(config);
    const original = candidate();
    const replacement = candidate(1, 1);
    cache.set(original.root, original.block, original.bytes);
    expect(cache.getOrSerialize(replacement.root, replacement.block).bytes).toEqual(replacement.bytes);
    expect(cache.get(original.root)?.bytes).toBe(original.bytes);
  });

  it("rejects a mismatched root without replacing the existing entry", () => {
    const cache = new BlockSerializedCache(config);
    const original = candidate();
    const unrelated = candidate(2);
    const entry = cache.set(original.root, original.block, original.bytes);
    expect(() => cache.getOrDeserialize(original.signedBlockRoot, unrelated.bytes)).toThrow(
      "SIGNED_BLOCK_ROOT_MISMATCH"
    );
    expect(cache.get(original.root)).toBe(entry);
  });

  it("rejects different signature bytes under a cached signed root without replacing either candidate", () => {
    const cache = new BlockSerializedCache(config);
    const original = candidate();
    const other = candidate(1, 1);
    const entry = cache.set(original.root, original.block, original.bytes);

    expect(() => cache.getOrDeserialize(original.signedBlockRoot, other.bytes)).toThrow("SIGNED_BLOCK_ROOT_MISMATCH");
    expect(cache.get(original.root)).toBe(entry);
    expect(cache.get(other.root)).toBeUndefined();
  });

  it("rejects malformed offsets even when the claimed root and signature match a cached candidate", () => {
    const cache = new BlockSerializedCache(config);
    const original = candidate();
    const entry = cache.set(original.root, original.block, original.bytes);
    const bytes = original.bytes.slice();
    new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).setUint32(0, 0, true);

    expect(() => cache.getOrDeserialize(original.signedBlockRoot, bytes)).toThrow(
      expect.objectContaining({type: {code: "INVALID_BLOCK_SSZ"}})
    );
    expect(cache.get(original.root)).toBe(entry);
  });

  it("bounds multiple signed candidates for the same message root", () => {
    const cache = new BlockSerializedCache(config, {maxItems: 2});
    const blocks = [candidate(1, 0), candidate(1, 1), candidate(1, 2)];
    for (const {root, block, bytes} of blocks) cache.set(root, block, bytes);

    expect(cache.get(blocks[0].root)).toBeUndefined();
    expect(cache.get(blocks[1].root)?.block).toBe(blocks[1].block);
    expect(cache.get(blocks[2].root)?.block).toBe(blocks[2].block);
    cache.prune(2);
    expect(cache.get(blocks[1].root)).toBeUndefined();
    expect(cache.get(blocks[2].root)).toBeUndefined();
  });

  it("bounds entries and prunes blocks older than finalization", () => {
    const cache = new BlockSerializedCache(config, {maxItems: 2});
    const blocks = [candidate(1), candidate(2), candidate(3)];
    for (const {root, block, bytes} of blocks) cache.set(root, block, bytes);
    expect(cache.get(blocks[0].root)).toBeUndefined();
    expect(cache.get(blocks[1].root)?.block).toBe(blocks[1].block);
    cache.prune(3);
    expect(cache.get(blocks[1].root)).toBeUndefined();
    expect(cache.get(blocks[2].root)?.block).toBe(blocks[2].block);
  });

  it("reports reuse, retained bytes, eviction reasons and skipped deletions", async () => {
    const register = new RegistryMetricCreator();
    const metrics = createLodestarMetrics(register).blockSerializedCache;
    const logger = getMockedLogger();
    const cache = new BlockSerializedCache(config, {maxItems: 2, metrics, logger});
    const original = candidate(1);
    const second = candidate(2);
    const third = candidate(3);
    cache.get(original.root);
    cache.getOrSerialize(original.root, original.block);
    cache.getOrSerialize(original.root, original.block);
    cache.getOrDeserialize(original.signedBlockRoot, structuredClone(original.bytes));
    cache.getOrDeserialize(second.signedBlockRoot, second.bytes);
    cache.get(original.root);
    cache.delete(original.root, ssz.phase0.SignedBeaconBlock.clone(original.block), "rejected");
    cache.set(third.root, third.block, third.bytes);

    async function values(name: string) {
      const metric = register.getSingleMetric(`lodestar_block_cache_${name}`);
      if (!metric) throw Error(`Missing block cache metric ${name}`);
      return (await metric.get()).values.map(({labels, value}) => ({labels, value}));
    }
    expect(await values("entries")).toEqual([{labels: {owner: "engine"}, value: 2}]);
    expect(await values("bytes")).toEqual([
      {labels: {owner: "engine"}, value: second.bytes.length + third.bytes.length},
    ]);
    for (const operation of ["get", "serialize", "deserialize"]) {
      for (const result of ["hit", "miss"]) {
        expect(await values("lookups_total"), `${operation} ${result}`).toContainEqual({
          labels: {owner: "engine", operation, result},
          value: 1,
        });
      }
    }
    cache.prune(3);
    cache.delete(third.root, undefined, "persisted");
    cache.delete(third.root, undefined, "persisted");
    expect(await values("entries")).toEqual([{labels: {owner: "engine"}, value: 0}]);
    expect(await values("bytes")).toEqual([{labels: {owner: "engine"}, value: 0}]);
    expect(await values("insertions_total")).toEqual([{labels: {owner: "engine"}, value: 3}]);
    for (const reason of ["capacity", "finalized", "persisted"]) {
      expect(await values("removals_total"), reason).toContainEqual({labels: {owner: "engine", reason}, value: 1});
    }
    expect(await values("delete_misses_total")).toEqual([
      {labels: {owner: "engine", reason: "rejected", result: "object_mismatch"}, value: 1},
      {labels: {owner: "engine", reason: "persisted", result: "missing"}, value: 1},
    ]);
    expect(logger.debug).toHaveBeenCalledWith("Pruned block cache", {
      owner: "engine",
      reason: "capacity",
      removed: 1,
      size: 2,
      maxItems: 2,
    });
    expect(logger.debug).toHaveBeenCalledWith("Skipped block cache deletion for a different block object", {
      owner: "engine",
      reason: "rejected",
      signedBlockRootHex: original.root,
      slot: 1,
    });
  });
});
