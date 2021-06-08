import {join} from "path";
import {readFileSync, readdirSync} from "fs";
import {fromHexString} from "@chainsafe/ssz";
import {uncompress} from "snappyjs";
import {loadYamlFile} from "./util";

export interface IValidTestcase<T> {
  path: string;
  root: Uint8Array;
  serialized: Uint8Array;
  value: T;
}

export interface IInvalidTestcase {
  path: string;
  serialized: Uint8Array;
}

export function parseValue(value: unknown): unknown {
  if (typeof value === "boolean") {
    return value;
  } else if (typeof value === "string") {
    if (value.startsWith("0x")) {
      return fromHexString(value);
    } else {
      return BigInt(value);
    }
  } else if (typeof value === "bigint") {
    return BigInt(value);
  } else if (typeof value === "number") {
    return BigInt(value);
  } else if (typeof value === "object") {
    if (Array.isArray(value)) {
      return value.map(parseValue);
    } else {
      const obj: Record<string, unknown> = {};
      Object.keys(value as Record<string, unknown>).forEach((fieldName) => {
        obj[fieldName] = parseValue((value as Record<string, unknown>)[fieldName]);
      });
      return obj;
    }
  }
  throw new Error("Can't parse value " + value);
}

export function parseValidTestcase<T>(path: string): IValidTestcase<T> {
  // The root is stored in meta.yml as:
  //   root: 0xDEADBEEF
  const meta = loadYamlFile(join(path, "meta.yaml"));
  const root = fromHexString(meta.root as string);

  // The serialized value is stored in serialized.ssz_snappy
  const serialized = uncompress<Uint8Array>(readFileSync(join(path, "serialized.ssz_snappy")));

  // The value is stored in value.yml
  const value = parseValue(loadYamlFile(join(path, "value.yaml"))) as T;

  return {
    path,
    root,
    serialized,
    value,
  };
}

export function parseInvalidTestcase(path: string): IInvalidTestcase {
  // The serialized value is stored in serialized.ssz_snappy
  const serialized = uncompress(readFileSync(join(path, "serialized.ssz_snappy")));

  return {
    path,
    serialized,
  };
}

export function getValidTestcases<T>(path: string, prefix: string): IValidTestcase<T>[] {
  const subdirs = readdirSync(path);
  return subdirs
    .filter((dir) => dir.includes(prefix))
    .map((d) => join(path, d))
    .map(parseValidTestcase) as IValidTestcase<T>[];
}

export function getInvalidTestcases(path: string, prefix: string): IInvalidTestcase[] {
  const subdirs = readdirSync(path);
  return subdirs.filter((dir) => dir.includes(prefix)).map(parseInvalidTestcase);
}
