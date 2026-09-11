import fs from "node:fs";
import path from "node:path";
import jsyaml from "js-yaml";
import snappyWasm from "@chainsafe/snappy-wasm";
import {loadYaml} from "@lodestar/utils";

const decoder = new snappyWasm.Decoder();

// Decompress into a Buffer.alloc() so decoded output stays GC-tracked on the V8 heap.
// The native snappy Buffer is not tracked by GC and grows RSS unbounded across many fixtures.
function uncompress(data: Uint8Array): Buffer {
  const out = Buffer.alloc(snappyWasm.decompress_len(data));
  decoder.decompress_into(data, out);
  return out;
}

export type ValidTestCaseData = {
  root: string;
  serialized: Uint8Array;
  jsonValue: unknown;
};

/**
 * ssz_static
 * | Attestation
 *   | case_0
 *     | roots.yaml
 *     | serialized.ssz_snappy
 *     | value.yaml
 *
 * Docs: https://github.com/ethereum/consensus-specs/blob/v1.6.1/tests/formats/ssz_static/core.md
 */
export function parseSszStaticTestcase(dirpath: string): ValidTestCaseData {
  return parseSszValidTestcase(dirpath, "roots.yaml");
}

export function parseSszValidTestcase(dirpath: string, metaFilename: string): ValidTestCaseData {
  // The root is stored in meta.yml as:
  //   root: 0xDEADBEEF
  const metaStr = fs.readFileSync(path.join(dirpath, metaFilename), "utf8");
  const meta = jsyaml.load(metaStr) as {root: string};
  if (typeof meta.root !== "string") {
    throw Error(`meta.root not a string: ${meta.root}\n${metaStr}`);
  }

  // The serialized value is stored in serialized.ssz_snappy
  const serialized = uncompress(fs.readFileSync(path.join(dirpath, "serialized.ssz_snappy")));

  // The value is stored in value.yml
  const yamlPath = path.join(dirpath, "value.yaml");
  const yamlStr = fs.readFileSync(yamlPath, "utf8");
  const jsonValue = readYamlNumbersAsStrings(yamlStr);
  // type.fromJson(loadYamlFile(path.join(dirpath, "value.yaml")) as Json) as T;

  return {
    root: meta.root,
    serialized,
    jsonValue,
  };
}

export function readYamlNumbersAsStrings(yamlStr: string): unknown {
  return loadYaml(yamlStr);
}
