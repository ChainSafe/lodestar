import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {beforeAll, afterAll} from "vitest";
import {ContainerType, Type} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";
import {describeDirectorySpecTest, InputType, loadYamlFile} from "../../../src/single.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
// eslint-disable-next-line @typescript-eslint/naming-convention
const __dirname = path.dirname(fileURLToPath(import.meta.url));

/* eslint-disable @typescript-eslint/naming-convention */
/* eslint-disable mocha/no-exports, mocha/no-top-level-hooks */

export type SimpleStruct = {
  test: boolean;
  number: number;
};

export interface SimpleCase extends Iterable<string> {
  input: SimpleStruct;
  output: number;
  meta?: {
    bls_setting?: bigint;
  };
}

const sampleContainerType = new ContainerType({
  test: ssz.Boolean,
  number: ssz.UintNum64,
});

beforeAll(() => {
  yamlToSSZ(path.join(__dirname, "../_test_files/single/case0/input.yaml"), sampleContainerType);
  yamlToSSZ(path.join(__dirname, "../_test_files/single/case0/output.yaml"), ssz.UintNum64);
  yamlToSSZ(path.join(__dirname, "../_test_files/single/case1/input.yaml"), sampleContainerType);
  yamlToSSZ(path.join(__dirname, "../_test_files/single/case1/output.yaml"), ssz.UintNum64);
});

afterAll(() => {
  fs.unlinkSync(path.join(__dirname, "../_test_files/single/case0/input.ssz"));
  fs.unlinkSync(path.join(__dirname, "../_test_files/single/case0/output.ssz"));
  fs.unlinkSync(path.join(__dirname, "../_test_files/single/case1/input.ssz"));
  fs.unlinkSync(path.join(__dirname, "../_test_files/single/case1/output.ssz"));
});

describeDirectorySpecTest<SimpleCase, number>(
  "single spec test",
  path.join(__dirname, "../_test_files/single"),
  (testCase) => {
    return testCase.input.number;
  },
  {
    inputTypes: {
      input: InputType.YAML,
      output: InputType.YAML,
    },
    sszTypes: {
      input: sampleContainerType,
      output: ssz.UintNum64,
    },
    shouldError: (testCase) => !testCase.input.test,
    getExpected: (testCase) => testCase.output,
  }
);

function yamlToSSZ(file: string, sszSchema: Type<any>): void {
  const input = sszSchema.fromJson(loadYamlFile(file)) as {test: boolean; number: number};
  fs.writeFileSync(file.replace(".yaml", ".ssz"), sszSchema.serialize(input));
}
