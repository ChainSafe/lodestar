import fs from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {afterAll, beforeAll} from "vitest";
import {BooleanType, ContainerType, Type, UintNumberType} from "@chainsafe/ssz";
import {InputType, describeDirectorySpecTest, loadYamlFile} from "../../../src/single.js";

// Global variable __dirname no longer available in ES6 modules.
// Solutions: https://stackoverflow.com/questions/46745014/alternative-for-dirname-in-node-js-when-using-es6-modules
const __dirname = path.dirname(fileURLToPath(import.meta.url));

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

const uint64Type = new UintNumberType(8);
const sampleContainerType = new ContainerType({
  test: new BooleanType(),
  number: uint64Type,
});

beforeAll(() => {
  yamlToSSZ(path.join(__dirname, "../_test_files/single/case0/input.yaml"), sampleContainerType);
  yamlToSSZ(path.join(__dirname, "../_test_files/single/case0/output.yaml"), uint64Type);
  yamlToSSZ(path.join(__dirname, "../_test_files/single/case1/input.yaml"), sampleContainerType);
  yamlToSSZ(path.join(__dirname, "../_test_files/single/case1/output.yaml"), uint64Type);
  fs.writeFileSync(path.join(__dirname, "../_test_files/single/case1/input.ssz"), new Uint8Array());
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
    if (!testCase.input.test) {
      throw Error("test flag is false");
    }
    return testCase.input.number;
  },
  {
    inputTypes: {
      input: InputType.YAML,
      output: InputType.YAML,
    },
    sszTypes: {
      input: sampleContainerType,
      output: uint64Type,
    },
    shouldError: (testCase) => !testCase.input.test,
    getExpected: (testCase) => testCase.output,
  }
);

describeDirectorySpecTest<SimpleCase, number>(
  "single spec test input error",
  path.join(__dirname, "../_test_files/single"),
  (testCase) => testCase.input.number,
  {
    inputTypes: {
      input: InputType.SSZ,
      output: InputType.SSZ,
    },
    sszTypes: {
      input: sampleContainerType,
      output: uint64Type,
    },
    shouldErrorOnInput: (_error, _inputNames, name) => name.endsWith("/case1"),
    getExpected: (testCase) => testCase.output,
  }
);

function yamlToSSZ(file: string, sszSchema: Type<any>): void {
  const input = sszSchema.fromJson(loadYamlFile(file)) as {test: boolean; number: number};
  fs.writeFileSync(file.replace(".yaml", ".ssz"), sszSchema.serialize(input));
}
