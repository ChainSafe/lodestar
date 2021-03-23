/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {unlinkSync, writeFileSync} from "fs";
import {join} from "path";

import {ContainerType, Type, Json} from "@chainsafe/ssz";
import {Boolean, Number64} from "@chainsafe/lodestar-types/lib/primitive/ssz";
import {describeDirectorySpecTest} from "../../../src/single";
import {loadYamlFile} from "../../../src/util";

export interface ISimpleStruct {
  test: boolean;
  number: number;
}

export interface ISimpleCase extends Iterable<string> {
  input: ISimpleStruct;
  output: number;
}

const inputSchema = new ContainerType({
  fields: {
    test: Boolean,
    number: Number64,
  },
});

before(() => {
  yamlToSSZ(join(__dirname, "../_test_files/single/case0/input.yaml"), inputSchema);
  yamlToSSZ(join(__dirname, "../_test_files/single/case0/output.yaml"), Number64);
  yamlToSSZ(join(__dirname, "../_test_files/single/case1/input.yaml"), inputSchema);
  yamlToSSZ(join(__dirname, "../_test_files/single/case1/output.yaml"), Number64);
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
    sszTypes: {
      input: inputSchema,
      output: Number64,
    },
    shouldError: (testCase) => !testCase.input.test,
    getExpected: (testCase) => testCase.output,
  }
);

function yamlToSSZ(file: string, sszSchema: Type<any>): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const input: any = sszSchema.fromJson(loadYamlFile(file) as Json);
  if (input.number) {
    input.number = Number(input.number);
  }
  writeFileSync(file.replace(".yaml", ".ssz"), sszSchema.serialize(input));
}
