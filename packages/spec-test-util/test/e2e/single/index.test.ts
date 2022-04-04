/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {unlinkSync, writeFileSync} from "node:fs";
import {join} from "node:path";

import {ContainerType, Type} from "@chainsafe/ssz";
import {ssz} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType, loadYamlFile} from "../../../src/single";

/* eslint-disable @typescript-eslint/naming-convention */

export interface ISimpleStruct {
  test: boolean;
  number: number;
}

export interface ISimpleCase extends Iterable<string> {
  input: ISimpleStruct;
  output: number;
  meta?: {
    bls_setting?: BigInt;
  };
}

const sampleContainerType = new ContainerType({
  test: ssz.Boolean,
  number: ssz.UintNum64,
});

before(() => {
  yamlToSSZ(join(__dirname, "../_test_files/single/case0/input.yaml"), sampleContainerType);
  yamlToSSZ(join(__dirname, "../_test_files/single/case0/output.yaml"), ssz.UintNum64);
  yamlToSSZ(join(__dirname, "../_test_files/single/case1/input.yaml"), sampleContainerType);
  yamlToSSZ(join(__dirname, "../_test_files/single/case1/output.yaml"), ssz.UintNum64);
});

after(() => {
  unlinkSync(join(__dirname, "../_test_files/single/case0/input.ssz"));
  unlinkSync(join(__dirname, "../_test_files/single/case0/output.ssz"));
  unlinkSync(join(__dirname, "../_test_files/single/case1/input.ssz"));
  unlinkSync(join(__dirname, "../_test_files/single/case1/output.ssz"));
});

describeDirectorySpecTest<ISimpleCase, number>(
  "single spec test",
  join(__dirname, "../_test_files/single"),
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
  writeFileSync(file.replace(".yaml", ".ssz"), sszSchema.serialize(input));
}
