import {fromHex, toHex} from "@lodestar/utils";
import {BlobSchedule, ChainConfig, SpecValue, SpecValueTypeName, chainConfigTypes, isBlobSchedule} from "./types.js";

const MAX_UINT64_JSON = "18446744073709551615";

export function chainConfigToJson(config: ChainConfig): Record<string, string | Record<string, string>[]> {
  const json: Record<string, string | Record<string, string>[]> = {};

  for (const key of Object.keys(chainConfigTypes) as (keyof ChainConfig)[]) {
    const value = config[key];
    if (value !== undefined) {
      json[key] = serializeSpecValue(value, chainConfigTypes[key]);
    }
  }

  return json;
}

export function chainConfigFromJson(json: Record<string, unknown>): ChainConfig {
  const config = {} as ChainConfig;

  for (const key of Object.keys(chainConfigTypes) as (keyof ChainConfig)[]) {
    const value = json[key];
    if (value !== undefined) {
      config[key] = deserializeSpecValue(json[key], chainConfigTypes[key], key) as never;
    }
  }

  return config;
}

export function specValuesToJson(spec: Record<string, SpecValue>): Record<string, string | Record<string, string>[]> {
  const json: Record<string, string | Record<string, string>[]> = {};

  for (const key of Object.keys(spec)) {
    json[key] = serializeSpecValue(spec[key], toSpecValueTypeName(spec[key]));
  }

  return json;
}

/** Automatic inference of typeName. For critical variables define type names, else infer */
export function toSpecValueTypeName(value: SpecValue): SpecValueTypeName {
  if (value instanceof Uint8Array) return "bytes";
  if (typeof value === "number") return "number";
  if (typeof value === "bigint") return "bigint";
  if (typeof value === "string") return "string";
  if (isBlobSchedule(value)) return "blob_schedule";
  throw Error(`Unknown value type ${value}`);
}

export function serializeSpecValue(value: SpecValue, typeName: SpecValueTypeName): string | Record<string, string>[] {
  switch (typeName) {
    case "number":
      if (typeof value !== "number") {
        throw Error(`Invalid value ${value.toString()} expected number`);
      }
      if (value === Infinity) {
        return MAX_UINT64_JSON;
      }
      return value.toString(10);

    case "bigint":
      if (typeof value !== "bigint") {
        throw Error(`Invalid value ${value.toString()} expected bigint`);
      }
      return value.toString(10);

    case "bytes":
      if (!(value instanceof Uint8Array)) {
        throw Error(`Invalid value ${value.toString()} expected Uint8Array`);
      }
      return toHex(value);

    case "string":
      if (typeof value !== "string") {
        throw Error(`Invalid value ${value.toString()} expected string`);
      }
      return value;
    case "blob_schedule":
      if (!isBlobSchedule(value)) {
        throw Error(`Invalid value ${value.toString()} expected BlobSchedule`);
      }

      return value.map(({EPOCH, MAX_BLOBS_PER_BLOCK}) => ({
        EPOCH: EPOCH === Infinity ? MAX_UINT64_JSON : EPOCH.toString(10),
        MAX_BLOBS_PER_BLOCK: MAX_BLOBS_PER_BLOCK === Infinity ? MAX_UINT64_JSON : MAX_BLOBS_PER_BLOCK.toString(10),
      }));
  }
}

export function deserializeSpecValue(valueStr: unknown, typeName: SpecValueTypeName, keyName: string): SpecValue {
  if (typeName === "blob_schedule") {
    if (!Array.isArray(valueStr)) {
      throw Error("Invalid blob schedule must be an array");
    }

    const blobSchedule = valueStr.map((entry) => {
      if (typeof entry !== "object" || entry === null) {
        throw Error(`Invalid blob schedule entry ${entry}`);
      }

      const out: Record<string, unknown> = {...entry};

      for (const key of ["EPOCH", "MAX_BLOBS_PER_BLOCK"]) {
        const raw = entry[key];
        if (raw === MAX_UINT64_JSON) {
          out[key] = Infinity;
        } else {
          out[key] = parseInt(raw, 10);
        }
      }

      return out;
    });

    return blobSchedule as BlobSchedule;
  }

  if (typeof valueStr !== "string") {
    throw Error(`Invalid ${keyName} value ${valueStr} expected string`);
  }

  switch (typeName) {
    case "number":
      if (valueStr === MAX_UINT64_JSON) {
        return Infinity;
      }
      return parseInt(valueStr, 10);

    case "bigint":
      return BigInt(valueStr);

    case "bytes":
      return fromHex(valueStr);

    case "string":
      return valueStr;
  }
}
