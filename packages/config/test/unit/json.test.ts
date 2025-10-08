import {describe, expect, it} from "vitest";
import {MAX_BLOB_COMMITMENTS_PER_BLOCK} from "@lodestar/params";
import {chainConfig} from "../../src/default.js";
import {BlobSchedule, chainConfigFromJson, chainConfigToJson} from "../../src/index.js";

describe("chainConfig JSON", () => {
  it("Convert to and from JSON", () => {
    const json = chainConfigToJson(chainConfig);
    const chainConfigRes = chainConfigFromJson(json);

    expect(chainConfigRes).toEqual(chainConfig);
  });

  it("Custom blob schedule", () => {
    const blobSchedule: BlobSchedule = [
      {EPOCH: 0, MAX_BLOBS_PER_BLOCK: 10},
      {EPOCH: 10, MAX_BLOBS_PER_BLOCK: 15},
      {EPOCH: Infinity, MAX_BLOBS_PER_BLOCK: 20},
    ];
    const configWithCustomBlobSchedule = {...chainConfig, BLOB_SCHEDULE: blobSchedule};

    const json = chainConfigToJson(configWithCustomBlobSchedule);
    const chainConfigRes = chainConfigFromJson(json);

    expect(chainConfigRes).toEqual(configWithCustomBlobSchedule);
  });

  it("Blob schedule max blobs exceeds limit", () => {
    const blobSchedule: BlobSchedule = [{EPOCH: 0, MAX_BLOBS_PER_BLOCK: MAX_BLOB_COMMITMENTS_PER_BLOCK + 1}];
    const configWithCustomBlobSchedule = {...chainConfig, BLOB_SCHEDULE: blobSchedule};

    const json = chainConfigToJson(configWithCustomBlobSchedule);

    expect(() => chainConfigFromJson(json)).toThrow();
  });

  it("Blob schedule in wrong order", () => {
    const blobSchedule: BlobSchedule = [
      {EPOCH: 20, MAX_BLOBS_PER_BLOCK: 20},
      {EPOCH: 10, MAX_BLOBS_PER_BLOCK: 15},
      {EPOCH: 0, MAX_BLOBS_PER_BLOCK: 10},
    ];

    const configWithCustomBlobSchedule = {...chainConfig, BLOB_SCHEDULE: blobSchedule};

    const json = chainConfigToJson(configWithCustomBlobSchedule);

    expect(() => chainConfigFromJson(json)).toThrow();
  });

  it("Blob schedule entries with the same epoch value", () => {
    const blobSchedule: BlobSchedule = [
      {EPOCH: 0, MAX_BLOBS_PER_BLOCK: 10},
      {EPOCH: 10, MAX_BLOBS_PER_BLOCK: 15},
      {EPOCH: 10, MAX_BLOBS_PER_BLOCK: 20},
    ];

    const configWithCustomBlobSchedule = {...chainConfig, BLOB_SCHEDULE: blobSchedule};

    const json = chainConfigToJson(configWithCustomBlobSchedule);

    expect(() => chainConfigFromJson(json)).toThrow();
  });
});
