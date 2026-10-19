import {afterEach, describe, expect, it, vi} from "vitest";
import {BitArray} from "@chainsafe/ssz";
import {createChainForkConfig} from "@lodestar/config";
import {chainConfig} from "@lodestar/config/default";
import {ForkName} from "@lodestar/params";
import {ssz, sszTypesFor} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {BlockSerializedCache} from "../../../../src/chain/blocks/blockSerializedCache.js";
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
    return {
      block,
      bytes: ssz.phase0.SignedBeaconBlock.serialize(block),
      root: toRootHex(ssz.phase0.BeaconBlock.hashTreeRoot(block.message)),
    };
  }

  it("reuses the main-thread block and original bytes across cloned inputs", () => {
    const cache = new BlockSerializedCache(config);
    const {block, bytes, root} = candidate();
    const entry = cache.set(root, block, bytes);
    const deserialize = vi.spyOn(ssz.phase0.SignedBeaconBlock, "deserialize");
    expect(cache.getOrDeserialize(root, structuredClone(bytes))).toBe(entry);
    expect(cache.getOrSerialize(root, block)).toBe(entry);
    expect(cache.set(root, ssz.phase0.SignedBeaconBlock.clone(block), structuredClone(bytes))).toBe(entry);
    expect(entry.block).toBe(block);
    expect(entry.bytes).toBe(bytes);
    expect(deserialize).not.toHaveBeenCalled();
  });

  it("deserializes once without sharing mutable fields with the retained bytes", () => {
    const cache = new BlockSerializedCache(config);
    const {block, bytes, root} = candidate();
    const deserialize = vi.spyOn(ssz.phase0.SignedBeaconBlock, "deserialize");
    const entry = cache.getOrDeserialize(root, bytes);
    expect(entry.block).toEqual(block);
    expect(entry.block.signature.buffer).not.toBe(bytes.buffer);
    expect(cache.getOrDeserialize(root, structuredClone(bytes))).toBe(entry);
    expect(deserialize).toHaveBeenCalledExactlyOnceWith(bytes, {reuseBytes: false});
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
      const root = toRootHex(types.BeaconBlock.hashTreeRoot(block.message));
      const cache = new BlockSerializedCache(config);

      const entry = cache.getOrDeserialize(root, bytes, fork);

      expect(entry.block).toEqual(block);
      expect(bytes).toEqual(originalBytes);
      expect(entry.bytes).toBe(bytes);
      expect(types.SignedBeaconBlock.equals(types.SignedBeaconBlock.deserialize(entry.bytes), block)).toBe(true);
      entry.block.message.body.attestations[0].aggregationBits.set(0, true);
      expect(bytes).toEqual(originalBytes);
    }
  );

  it("does not reuse another signature for the same block root", () => {
    const cache = new BlockSerializedCache(config);
    const original = candidate();
    const replacement = candidate(1, 1);
    expect(replacement.root).toBe(original.root);
    cache.set(original.root, original.block, original.bytes);
    const entry = cache.getOrDeserialize(replacement.root, replacement.bytes);
    expect(entry.block.signature).toEqual(replacement.block.signature);
    expect(entry.bytes).toBe(replacement.bytes);
    cache.delete(original.root, original.block);
    expect(cache.get(original.root)).toBe(entry);
    cache.delete(original.root, entry.block);
    expect(cache.get(original.root)).toBeUndefined();
  });

  it("serializes a different signature instead of returning stale bytes", () => {
    const cache = new BlockSerializedCache(config);
    const original = candidate();
    const replacement = candidate(1, 1);
    cache.set(original.root, original.block, original.bytes);
    expect(cache.getOrSerialize(replacement.root, replacement.block).bytes).toEqual(replacement.bytes);
  });

  it("rejects a mismatched root without replacing the existing entry", () => {
    const cache = new BlockSerializedCache(config);
    const original = candidate();
    const unrelated = candidate(2);
    const entry = cache.set(original.root, original.block, original.bytes);
    expect(() => cache.getOrDeserialize(original.root, unrelated.bytes)).toThrow("BLOCK_ROOT_MISMATCH");
    expect(cache.get(original.root)).toBe(entry);
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
    const cache = new BlockSerializedCache(config, {owner: "chain", maxItems: 2, metrics, logger});
    const original = candidate(1);
    const replacement = candidate(1, 1);
    const second = candidate(2);
    const third = candidate(3);
    cache.get(original.root);
    cache.getOrSerialize(original.root, original.block);
    cache.getOrSerialize(original.root, original.block);
    cache.getOrDeserialize(original.root, structuredClone(original.bytes));
    cache.getOrDeserialize(second.root, second.bytes);
    cache.get(original.root);
    cache.set(replacement.root, replacement.block, replacement.bytes);
    cache.delete(original.root, original.block, "rejected");
    cache.set(third.root, third.block, third.bytes);

    async function values(name: string) {
      const metric = register.getSingleMetric(`lodestar_block_cache_${name}`);
      if (!metric) throw Error(`Missing block cache metric ${name}`);
      return (await metric.get()).values.map(({labels, value}) => ({labels, value}));
    }
    expect(await values("entries")).toEqual([{labels: {owner: "chain"}, value: 2}]);
    expect(await values("bytes")).toEqual([
      {labels: {owner: "chain"}, value: replacement.bytes.length + third.bytes.length},
    ]);
    for (const operation of ["get", "serialize", "deserialize"]) {
      for (const result of ["hit", "miss"]) {
        expect(await values("lookups_total"), `${operation} ${result}`).toContainEqual({
          labels: {owner: "chain", operation, result},
          value: 1,
        });
      }
    }
    cache.prune(2);
    cache.delete(third.root, undefined, "persisted");
    cache.delete(third.root, undefined, "persisted");
    expect(await values("entries")).toEqual([{labels: {owner: "chain"}, value: 0}]);
    expect(await values("bytes")).toEqual([{labels: {owner: "chain"}, value: 0}]);
    expect(await values("insertions_total")).toEqual([{labels: {owner: "chain"}, value: 4}]);
    for (const reason of ["replaced", "capacity", "finalized", "persisted"]) {
      expect(await values("removals_total"), reason).toContainEqual({labels: {owner: "chain", reason}, value: 1});
    }
    expect(await values("delete_misses_total")).toEqual([
      {labels: {owner: "chain", reason: "rejected", result: "object_mismatch"}, value: 1},
      {labels: {owner: "chain", reason: "persisted", result: "missing"}, value: 1},
    ]);
    expect(logger.debug).toHaveBeenCalledWith("Pruned block cache", {
      owner: "chain",
      reason: "capacity",
      removed: 1,
      size: 2,
      maxItems: 2,
    });
    expect(logger.debug).toHaveBeenCalledWith("Skipped block cache deletion for a different block object", {
      owner: "chain",
      reason: "rejected",
      root: original.root,
      slot: 1,
    });
  });

  it("keeps shared, main-thread and engine metric series separate", async () => {
    const register = new RegistryMetricCreator();
    const metrics = createLodestarMetrics(register).blockSerializedCache;
    const {root, block, bytes} = candidate();
    for (const owner of ["shared", "chain", "engine"] as const) {
      new BlockSerializedCache(config, {owner, metrics}).set(root, block, bytes);
    }
    const metric = register.getSingleMetric("lodestar_block_cache_entries");
    expect((await metric?.get())?.values).toEqual([
      {labels: {owner: "shared"}, value: 1},
      {labels: {owner: "chain"}, value: 1},
      {labels: {owner: "engine"}, value: 1},
    ]);
  });
});
