import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {ForkName, NUMBER_OF_COLUMNS, SLOTS_PER_EPOCH} from "@lodestar/params";
import {resolveServingPolicy} from "../../../../../src/network/reqresp/serving/policy.js";
import {
  BeaconBlocksByRootRequestType,
  BlobSidecarsByRootRequestType,
  DataColumnSidecarsByRootRequestType,
} from "../../../../../src/util/types.js";
import {registerServingSchemaCases, servingConfig} from "../../../../utils/network/reqresp/servingCases.js";

const MiB = 1024 * 1024;
registerServingSchemaCases();
describe("serving policy", () => {
  it("preserves canonical request maxima with scalar cardinality separate from bytes", () => {
    const config = servingConfig();
    const policy = resolveServingPolicy(config, 16, 0);
    const columnsType = DataColumnSidecarsByRootRequestType(config);
    const identifiers = Array.from({length: config.MAX_REQUEST_BLOCKS_DENEB}, () => ({
      blockRoot: new Uint8Array(32),
      columns: Array.from({length: NUMBER_OF_COLUMNS}, (_, i) => i),
    }));
    const decoded = columnsType.deserialize(columnsType.serialize(identifiers));
    expect(decoded).toHaveLength(128);
    expect(decoded.reduce((sum, value) => sum + value.columns.length, 0)).toBe(16384);
    expect(policy.requestScalars).toBeGreaterThanOrEqual(16384);
    expect(policy.requestMetadata).toBeGreaterThanOrEqual(decoded.length * 3 + 1);
    expect(policy.requestDecodedBytes).toBeGreaterThanOrEqual(decoded.length * 32);
    expect(policy.decodedBytes).toBe(128 * 1024);
    for (const fork of [ForkName.phase0, ForkName.deneb, ForkName.electra, ForkName.fulu]) {
      const blocksType = BeaconBlocksByRootRequestType(fork, config);
      const blocks = Array.from({length: blocksType.limit}, () => new Uint8Array(32));
      expect(blocksType.deserialize(blocksType.serialize(blocks))).toHaveLength(blocks.length);
      expect(policy.requestDecodedBytes).toBeGreaterThanOrEqual(blocks.length * 32);
      const blobsType = BlobSidecarsByRootRequestType(fork, config);
      const blobs = Array.from({length: blobsType.limit}, () => ({blockRoot: new Uint8Array(32), index: 0}));
      expect(blobsType.deserialize(blobsType.serialize(blobs))).toHaveLength(blobs.length);
      expect(policy.requestDecodedBytes).toBeGreaterThanOrEqual(blobs.length * 32);
    }
  });
  for (const [blobs, cap] of [
    [21, 10],
    [39, 11],
    [64, 17],
    [128, 34],
  ]) {
    it(`separates B${blobs} C${cap} request capacity from production work`, () => {
      const policy = resolveServingPolicy(servingConfig(blobs), 16, 0);
      expect(policy.sourceBytes).toBe(cap * MiB);
      expect(policy.capacity).toBe(16);
      expect(policy.maxTasks).toBe(6);
      expect(policy.workingBytes).toBe(3 * cap * MiB);
      expect(policy.ancestrySteps).toBe(Math.max(256 * SLOTS_PER_EPOCH, servingConfig().MAX_REQUEST_BLOCKS));
      if (blobs === 21) expect(policy.columnBatchBytes).toBe(5808640);
    });
  }
  it("fails if a legal maximum task cannot fit, and accepts explicit H", () => {
    expect(() => resolveServingPolicy(servingConfig(256), 16, 0)).toThrow("No maximum");
    const policy = resolveServingPolicy(servingConfig(256), 16, 0, {
      totalBytes: 512 * MiB,
      maxTasks: 2,
      ancestrySteps: 20000,
      transactionVisits: 17,
    });
    expect(policy.sourceBytes).toBe(68 * MiB);
    expect(policy.capacity).toBe(16);
    expect(policy.maxTasks).toBe(2);
    expect(policy.ancestrySteps).toBe(20000);
    expect(policy.transactionVisits).toBe(17);
  });
  it("requires nonzero admission", () => {
    expect(() => resolveServingPolicy(servingConfig(), 0, 0)).toThrow("incoming");
    expect(() => resolveServingPolicy(servingConfig(), 1, 0, {maxTasks: 0})).toThrow("tasks");
  });
  it("accepts future Gloas and rejects at and after activation", () => {
    const config = createBeaconConfig(
      {...servingConfig(), GLOAS_FORK_EPOCH: 6, HEZE_FORK_EPOCH: 7},
      new Uint8Array(32)
    );
    expect(resolveServingPolicy(config, 6, -1).sourceBytes).toBe(10 * MiB);
    expect(() => resolveServingPolicy(config, 6, NaN)).toThrow("current serving slot");
    expect(resolveServingPolicy(config, 6, 6 * SLOTS_PER_EPOCH - 1).sourceBytes).toBe(10 * MiB);
    for (const slot of [6 * SLOTS_PER_EPOCH, 7 * SLOTS_PER_EPOCH, 8 * SLOTS_PER_EPOCH])
      expect(() => resolveServingPolicy(config, 6, slot)).toThrow("Unsupported serving fork");
  });
  for (const value of [NaN, Infinity, -1, 0.5]) {
    it(`rejects invalid schedule epoch ${value}`, () => {
      const config = servingConfig();
      config.BLOB_SCHEDULE[0].EPOCH = value;
      expect(() => resolveServingPolicy(config, 6, 0)).toThrow();
    });
  }
});
