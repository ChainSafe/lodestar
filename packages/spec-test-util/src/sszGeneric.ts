import path from "node:path";
import fs from "node:fs";
import {uncompress} from "snappyjs";
import {loadYaml} from "@lodestar/utils";

/* eslint-disable @typescript-eslint/explicit-function-return-type */

export type ValidTestCaseData = {
  root: string;
  serialized: Uint8Array;
  jsonValue: unknown;
};

export function parseSszValidTestcase(dirpath: string, metaFilename: string): ValidTestCaseData {
  // The root is stored in meta.yml as:
  //   root: 0xDEADBEEF
  const metaStr = fs.readFileSync(path.join(dirpath, metaFilename), "utf8");
  const meta = loadYaml(metaStr) as {root: string};
  if (typeof meta.root !== "string") {
    throw Error(`meta.root not a string: ${meta.root}\n${fs}`);
  }

  // The serialized value is stored in serialized.ssz_snappy
  const serialized = uncompress<Uint8Array>(fs.readFileSync(path.join(dirpath, "serialized.ssz_snappy")));

  // The value is stored in value.yml
  const yamlPath = path.join(dirpath, "value.yaml");
  const yamlStrNumbersAsNumbers = fs.readFileSync(yamlPath, "utf8");
  const jsonValue = readYamlNumbersAsStrings(yamlStrNumbersAsNumbers);

  // type.fromJson(loadYamlFile(path.join(dirpath, "value.yaml")) as Json) as T;

  return {
    root: meta.root,
    serialized,
    jsonValue,
  };
}

/**
 * ssz_generic
 * | basic_vector
 *   | invalid
 *     | vec_bool_0
 *       | serialized.ssz_snappy
 *
 * Docs: https://github.com/ethereum/eth2.0-specs/blob/master/tests/formats/ssz_generic/README.md
 */
export function parseSszGenericInvalidTestcase(dirpath: string) {
  // The serialized value is stored in serialized.ssz_snappy
  const serialized = uncompress(fs.readFileSync(path.join(dirpath, "serialized.ssz_snappy")));

  return {
    serialized,
  };
}

export function readYamlNumbersAsStrings(yamlStr: string): unknown {
  return loadYaml(yamlStr);
}
