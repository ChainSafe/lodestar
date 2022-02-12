import fs from "node:fs";
import {loadYaml} from "@chainsafe/lodestar-utils";
import {expect} from "chai";

/* eslint-disable
  @typescript-eslint/no-unsafe-call,
  @typescript-eslint/no-unsafe-member-access,
  @typescript-eslint/no-unsafe-return,
  @typescript-eslint/no-unsafe-assignment,
  @typescript-eslint/no-explicit-any,
  @typescript-eslint/no-unused-vars,
  @typescript-eslint/naming-convention,
  func-names */

export interface IBaseCase {
  description: string;
}

/**
 * TestSpec - represent structure of yaml file containing spec test cases
 * TestCase - single test case, usually under test_cases property in yaml file
 */
// eslint-disable-next-line @typescript-eslint/naming-convention
interface TestSpec<TestCase extends IBaseCase> {
  title: string;
  summary: string;
  forks_timeline: string;
  forks: string;
  config: string;
  runner: string;
  handler: string;
  test_cases: TestCase[];
}

/**
 * Run yaml Eth2.0 bulk spec tests (m) for a certain function
 * Compares actual vs expected for all test cases
 * @param {string} testYamlPath - path to yaml spec test
 * @param {Function} testFunc - function to use to generate output
 * @param {Function} getInput - function to convert test case into input array
 * @param {Function} getExpected - function to convert test case into a
 *   comparable expected output
 * @param {Function} getActual - function to convert function output into
 *   comparable actual output
 * @param {Function} shouldError - function to convert test case into a
 *   boolean, if the case should result in an error
 * @param {Function} shouldSkip - function to convert test case into a boolean,
 *   if the case should be skipped
 * @param {Function} expectFunc - function to run expectations against expected
 *   and actual output
 * @param timeout - how long to wait before marking tests as failed (default 2000ms). Set to 0 to wait infinitely
 */
export function describeMultiSpec<TestCase extends IBaseCase, Result>(
  testYamlPath: string,
  testFunc: (...args: any) => any,
  getInput: (testCase: TestCase) => any,
  getExpected: (testCase: TestCase) => any,
  getActual: (result: any) => Result,
  shouldError = (testCase: TestCase, index: number) => false,
  shouldSkip = (testCase: TestCase, index: number) => false,
  expectFunc = (testCase: TestCase, expect: any, expected: any, actual: any) => expect(actual).to.be.equal(expected),
  timeout = 10 * 60 * 1000
): void {
  const testSpec = loadYaml<TestSpec<TestCase>>(fs.readFileSync(testYamlPath, "utf8"));

  const testSuiteName = `${testSpec.runner} - ${testSpec.handler} - ${testSpec.title} - ${testSpec.config}`;

  describe(testSuiteName, function () {
    this.timeout(timeout);
    for (const [index, testCase] of testSpec.test_cases.entries()) {
      if (shouldSkip(testCase, index)) {
        continue;
      }
      const description = index + (testCase.description ? " - " + testCase.description : "");
      it(description, function () {
        const inputs = getInput(testCase);
        if (shouldError(testCase, index)) {
          expect(testFunc.bind(null, ...inputs)).to.throw();
        } else {
          const result = testFunc(...inputs);
          const actual = getActual(result);
          const expected = getExpected(testCase);
          expectFunc(testCase, expect, expected, actual);
        }
      });
    }
  });
}
