/* eslint-disable @typescript-eslint/no-unsafe-return */
import {IBaseCase, describeMultiSpec} from "../../../src";
import path from "node:path";

interface IBulkTestCase extends IBaseCase {
  input: string;
  output: string;
}

describeMultiSpec<IBulkTestCase, string>(
  path.join(__dirname, "../_test_files/multi/bulk.yml"),
  (input) => input,
  (testCase) => [testCase.input],
  (testCase) => testCase.output,
  (result) => result
);
