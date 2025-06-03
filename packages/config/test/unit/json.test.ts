import {describe, expect, it} from "vitest";
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
      {EPOCH: 10, MAX_BLOBS_PER_BLOCK: Infinity},
      {EPOCH: Infinity, MAX_BLOBS_PER_BLOCK: 20},
      {EPOCH: Infinity, MAX_BLOBS_PER_BLOCK: Infinity},
    ];
    const configWithCustomBlobSchedule = {...chainConfig, BLOB_SCHEDULE: blobSchedule};

    const json = chainConfigToJson(configWithCustomBlobSchedule);
    const chainConfigRes = chainConfigFromJson(json);

    expect(chainConfigRes).toEqual(configWithCustomBlobSchedule);
  });
});
