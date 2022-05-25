import {fromHexString, toHexString} from "@chainsafe/ssz";
import {IChainConfig, chainConfigTypes, SpecValue, SpecValueTypeName} from "./types.js";

const MAX_UINT64_JSON = "18446744073709551615";

export function chainConfigToJson(config: IChainConfig): Record<string, string> {
  const json: Record<string, string> = {};

  for (const key of Object.keys(config) as (keyof IChainConfig)[]) {
    json[key] = serializeSpecValue(config[key], chainConfigTypes[key]);
  }

  return json;
}

export function chainConfigFromJson(json: Record<string, unknown>): IChainConfig {
  const config = {} as IChainConfig;

  for (const key of Object.keys(json) as (keyof IChainConfig)[]) {
    config[key] = deserializeSpecValue(json[key], chainConfigTypes[key]) as never;
  }

  return config;
}

export function serializeSpecValue(value: SpecValue, typeName: SpecValueTypeName): string {
  switch (typeName) {
    case "number":
      if (typeof value !== "number") {
        throw Error(`Invalid value ${value} expected number`);
      }
      if (value === Infinity) {
        return MAX_UINT64_JSON;
      }
      return value.toString(10);

    case "bigint":
      if (typeof value !== "bigint") {
        throw Error(`Invalid value ${value} expected bigint`);
      }
      return value.toString(10);

    case "bytes":
      if (!(value instanceof Uint8Array)) {
        throw Error(`Invalid value ${value} expected Uint8Array`);
      }
      return toHexString(value);

    case "string":
      if (typeof value !== "string") {
        throw Error(`Invalid value ${value} expected string`);
      }
      return value;
  }
}

export function deserializeSpecValue(valueStr: unknown, typeName: SpecValueTypeName): SpecValue {
  if (typeof valueStr !== "string") {
    throw Error(`Invalid value ${valueStr} expected string`);
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
      return fromHexString(valueStr);

    case "string":
      return valueStr;
  }
}
