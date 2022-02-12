import path, {join} from "node:path";
import fs, {readFileSync, readdirSync} from "node:fs";
import {Json, Type} from "@chainsafe/ssz";
import {loadYaml, objectToExpectedCase} from "@chainsafe/lodestar-utils";
import {uncompress} from "snappyjs";

export interface IValidTestcase<T> {
  root: string;
  serialized: Uint8Array;
  value: T;
}

export interface IInvalidTestcase {
  path: string;
  serialized: Uint8Array;
}

export function parseValidTestcase<T>(dirpath: string, type: Type<T>): IValidTestcase<T> {
  // The root is stored in meta.yml as:
  //   root: 0xDEADBEEF
  const metaStr = fs.readFileSync(path.join(dirpath, "meta.yaml"), "utf8");
  const meta = loadYaml<{root: string}>(metaStr);
  if (typeof meta.root !== "string") {
    throw Error(`meta.root not a string: ${meta.root}\n${fs}`);
  }
  // The serialized value is stored in serialized.ssz_snappy
  const serialized = uncompress<Uint8Array>(readFileSync(join(dirpath, "serialized.ssz_snappy")));

  // The value is stored in value.yml
  const yamlSnake = loadYaml(fs.readFileSync(join(dirpath, "value.yaml"), "utf8"));
  const yamlCamel = objectToExpectedCase(yamlSnake, "camel");
  const value = type.fromJson(yamlCamel as Json);

  return {
    root: meta.root,
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
