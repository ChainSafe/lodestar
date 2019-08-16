import {BaseCase, describeMultiSpec} from "../../../src/multi";
import path from "path";

interface BulkTestCase extends BaseCase {
  input: string;
  output: string;
}

describeMultiSpec<BulkTestCase, string>(
  path.join(__dirname, '../_test_files/bulk/bulk.yml'),
  (input) => input,
  (testCase => [testCase.input]),
  (testCase => testCase.output),
  (result => result)
);