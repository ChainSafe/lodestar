import {beforeAll, describe, expect, it} from "vitest";
import {chainConfig} from "../../src/default.js";
import {ChainConfig, createForkConfig} from "../../src/index.js";

describe("getMaxBlobsPerBlock", () => {
  let defaultConfig: ChainConfig;

  beforeAll(() => {
    // Force tests to run on fulu fork
    // TODO Fulu: getMaxBlobsPerBlock's result is hardcoded for deneb and electra in fusaka devnet-0. So we need to define
    // defaultConfig to force tests to run on fulu to get expected result. Remove this after devnet-0.
    defaultConfig = {
      ...chainConfig,
      ALTAIR_FORK_EPOCH: 0,
      BELLATRIX_FORK_EPOCH: 0,
      CAPELLA_FORK_EPOCH: 0,
      DENEB_FORK_EPOCH: 0,
      ELECTRA_FORK_EPOCH: 0,
      FULU_FORK_EPOCH: 0,
    };
  });

  it("should throw an error if BLOB_SCHEDULE is empty", () => {
    const config = createForkConfig({...defaultConfig, BLOB_SCHEDULE: []});

    expect(() => config.getMaxBlobsPerBlock(0)).toThrowError();
  });

  it("should return same value for passed epochs if there is only a single BLOB_SCHEDULE entry", () => {
    const config = createForkConfig({
      ...defaultConfig,
      BLOB_SCHEDULE: [{EPOCH: 0, MAX_BLOBS_PER_BLOCK: 10}],
    });

    expect(config.getMaxBlobsPerBlock(0)).toEqual(10);
    expect(config.getMaxBlobsPerBlock(5)).toEqual(10);
    expect(config.getMaxBlobsPerBlock(10)).toEqual(10);
  });

  it("should select correct value for passed epoch based on BLOB_SCHEDULE thresholds", () => {
    const config = createForkConfig({
      ...defaultConfig,
      BLOB_SCHEDULE: [
        {EPOCH: 0, MAX_BLOBS_PER_BLOCK: 1},
        {EPOCH: 2, MAX_BLOBS_PER_BLOCK: 2},
        {EPOCH: 4, MAX_BLOBS_PER_BLOCK: 3},
      ],
    });

    expect(config.getMaxBlobsPerBlock(0)).toEqual(1);
    expect(config.getMaxBlobsPerBlock(1)).toEqual(1);
    expect(config.getMaxBlobsPerBlock(2)).toEqual(2);
    expect(config.getMaxBlobsPerBlock(3)).toEqual(2);
    expect(config.getMaxBlobsPerBlock(4)).toEqual(3);
    expect(config.getMaxBlobsPerBlock(100)).toEqual(3);
  });

  it("should return correct values if BLOB_SCHEDULE entries are unsorted", () => {
    const config = createForkConfig({
      ...defaultConfig,
      BLOB_SCHEDULE: [
        {EPOCH: 15, MAX_BLOBS_PER_BLOCK: 1},
        {EPOCH: 5, MAX_BLOBS_PER_BLOCK: 3},
        {EPOCH: 10, MAX_BLOBS_PER_BLOCK: 5},
      ],
    });
    expect(config.getMaxBlobsPerBlock(0)).toEqual(1);
    expect(config.getMaxBlobsPerBlock(6)).toEqual(3);
    expect(config.getMaxBlobsPerBlock(10)).toEqual(5);
    expect(config.getMaxBlobsPerBlock(14)).toEqual(5);
    expect(config.getMaxBlobsPerBlock(15)).toEqual(1);
    expect(config.getMaxBlobsPerBlock(16)).toEqual(1);
  });

  it("should return minimum value if epoch is below lowest configured BLOB_SCHEDULE epoch", () => {
    const config = createForkConfig({
      ...defaultConfig,
      BLOB_SCHEDULE: [
        {EPOCH: 5, MAX_BLOBS_PER_BLOCK: 3},
        {EPOCH: 10, MAX_BLOBS_PER_BLOCK: 5},
        {EPOCH: 15, MAX_BLOBS_PER_BLOCK: 2},
      ],
    });
    expect(config.getMaxBlobsPerBlock(0)).toEqual(2);
  });
});
