import {describe, expect, it} from "vitest";
import {MAX_BLOB_COMMITMENTS_PER_BLOCK} from "@lodestar/params";
import {chainConfig} from "../../src/default.js";
import {BlobSchedule, GasLimitSchedule, chainConfigFromJson, chainConfigToJson} from "../../src/index.js";

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

  it("Custom gas limit schedule", () => {
    const gasLimitSchedule: GasLimitSchedule = [
      {EPOCH: 10, GAS_LIMIT: 60_000_000},
      {EPOCH: 20, GAS_LIMIT: 75_000_000},
      {EPOCH: Infinity, GAS_LIMIT: 90_000_000},
    ];
    const configWithCustomGasLimitSchedule = {...chainConfig, GAS_LIMIT_SCHEDULE: gasLimitSchedule};

    const json = chainConfigToJson(configWithCustomGasLimitSchedule);
    const chainConfigRes = chainConfigFromJson(json);

    expect(chainConfigRes).toEqual(configWithCustomGasLimitSchedule);
  });

  it("Gas limit schedule in wrong order", () => {
    const gasLimitSchedule: GasLimitSchedule = [
      {EPOCH: 20, GAS_LIMIT: 75_000_000},
      {EPOCH: 10, GAS_LIMIT: 60_000_000},
    ];
    const json = chainConfigToJson({...chainConfig, GAS_LIMIT_SCHEDULE: gasLimitSchedule});

    expect(() => chainConfigFromJson(json)).toThrow("Invalid GAS_LIMIT_SCHEDULE");
  });

  it("Gas limit schedule entries with the same epoch value", () => {
    const gasLimitSchedule: GasLimitSchedule = [
      {EPOCH: 10, GAS_LIMIT: 60_000_000},
      {EPOCH: 10, GAS_LIMIT: 75_000_000},
    ];
    const json = chainConfigToJson({...chainConfig, GAS_LIMIT_SCHEDULE: gasLimitSchedule});

    expect(() => chainConfigFromJson(json)).toThrow("same epoch value");
  });

  it.each([
    ["max uint64", "18446744073709551615"],
    ["above max safe integer", (BigInt(Number.MAX_SAFE_INTEGER) + 1n).toString()],
    ["negative", "-1"],
  ])("Gas limit schedule rejects %s GAS_LIMIT", (_name, gasLimit) => {
    const json = chainConfigToJson(chainConfig);
    json.GAS_LIMIT_SCHEDULE = [{EPOCH: "10", GAS_LIMIT: gasLimit}];

    expect(() => chainConfigFromJson(json)).toThrow("expected non-negative safe integer");
  });
});
