import {BaseCase, describeBulkTests} from "../../../src/bulk";
import path from "path";

interface BulkTestCase extends BaseCase {
  input: string;
  output: string;
}

describeBulkTests<BulkTestCase, string>(
  path.join(__dirname, '../_test_files/bulk/bulk.yml'),
  (input) => input,
  (testCase => [testCase.input]),
  (testCase => testCase.output),
  (result => result)
);