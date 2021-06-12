import {join} from "path";
import {readFileSync, readdirSync} from "fs";
import {fromHexString, Json, Type} from "@chainsafe/ssz";
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

export function parseValidTestcase<T>(path: string, type: Type<T>): IValidTestcase<T> {
  // The root is stored in meta.yml as:
  //   root: 0xDEADBEEF
  const meta = loadYamlFile(join(path, "meta.yaml"));
  const root = fromHexString(meta.root as string);

  // The serialized value is stored in serialized.ssz_snappy
  const serialized = uncompress<Uint8Array>(readFileSync(join(path, "serialized.ssz_snappy")));

  // The value is stored in value.yml
  const value = type.fromJson(loadYamlFile(join(path, "value.yaml")) as Json) as T;

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

export function getValidTestcases<T>(path: string, prefix: string, type: Type<T>): IValidTestcase<T>[] {
  const subdirs = readdirSync(path);
  return subdirs
    .filter((dir) => dir.includes(prefix))
    .map((d) => join(path, d))
    .map((p) => parseValidTestcase(p, type)) as IValidTestcase<T>[];
}

export function getInvalidTestcases(path: string, prefix: string): IInvalidTestcase[] {
  const subdirs = readdirSync(path);
  return subdirs
    .filter((dir) => dir.includes(prefix))
    .map((d) => join(path, d))
    .map(parseInvalidTestcase);
}
