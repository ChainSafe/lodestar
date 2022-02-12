/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import fs, {unlinkSync, writeFileSync} from "node:fs";
import {join} from "node:path";

import {ContainerType, Type, Json} from "@chainsafe/ssz";
import {ssz} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "../../../src/single";
import {loadYaml} from "@chainsafe/lodestar-utils";

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

const inputSchema = new ContainerType({
  fields: {
    test: ssz.Boolean,
    number: ssz.Number64,
  },
});

before(() => {
  yamlToSSZ(join(__dirname, "../_test_files/single/case0/input.yaml"), inputSchema);
  yamlToSSZ(join(__dirname, "../_test_files/single/case0/output.yaml"), ssz.Number64);
  yamlToSSZ(join(__dirname, "../_test_files/single/case1/input.yaml"), inputSchema);
  yamlToSSZ(join(__dirname, "../_test_files/single/case1/output.yaml"), ssz.Number64);
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
      input: inputSchema,
      output: ssz.Number64,
    },
    shouldError: (testCase) => !testCase.input.test,
    getExpected: (testCase) => testCase.output,
  }
);

function yamlToSSZ(file: string, sszSchema: Type<any>): void {
  // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
  const input: any = sszSchema.fromJson(loadYaml<Json>(fs.readFileSync(file, "utf8")));
  if (input.number) {
    input.number = Number(input.number);
  }
  writeFileSync(file.replace(".yaml", ".ssz"), sszSchema.serialize(input));
}
