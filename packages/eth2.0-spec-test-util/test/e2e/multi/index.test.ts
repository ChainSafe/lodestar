import {BaseCase, describeMultiSpec} from "../../../src";
import path from "path";

interface BulkTestCase extends BaseCase {
  input: string;
  output: string;
}

describeMultiSpec<BulkTestCase, string>(
  path.join(__dirname, '../_test_files/multi/bulk.yml'),
  (input) => input,
  (testCase => [testCase.input]),
  (testCase => testCase.output),
  (result => result)
);