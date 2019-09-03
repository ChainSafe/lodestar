import {writeFile} from "fs";
import {describe} from "mocha";
import {expect} from "chai";
import profiler from "v8-profiler-next";

import {loadYamlFile} from "./util";

export interface BaseCase {
  description: string;
}

/**
 * TestSpec - represent structure of yaml file containing spec test cases
 * TestCase - single test case, usually under test_cases property in yaml file
 */
interface TestSpec<TestCase extends BaseCase> {
  title: string;
  summary: string;
  forksTimeline: string;
  forks: string;
  config: string;
  runner: string;
  handler: string;
  testCases: TestCase[];
}

const env = process.env;

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
export function describeMultiSpec<TestCase extends BaseCase, Result>(
  testYamlPath: string,
  testFunc: (...args: any) => any,
  getInput: (testCase: TestCase) => any,
  getExpected: (testCase: TestCase) => any,
  getActual: (result: any) => Result,
  shouldError = (testCase: TestCase, index: number) => false,
  shouldSkip = (testCase: TestCase, index: number) => false,
  expectFunc = (testCase, expect, expected, actual) => expect(actual).to.be.equal(expected),
  timeout = 2000
): void {
  const testSpec = loadYamlFile(testYamlPath) as TestSpec<TestCase>;

  const testSuiteName = `${testSpec.runner} - ${testSpec.handler} - ${testSpec.title} - ${testSpec.config}`;

  describe(testSuiteName, function () {
    this.timeout(timeout);
    testSpec.testCases.forEach((testCase, index) => {
      if (shouldSkip(testCase, index)) {
        return;
      }
      const description = index + (testCase.description ? ' - ' + testCase.description : '');
      it(description, function () {
        const inputs = getInput(testCase);
        if (shouldError(testCase, index)) {
          expect(testFunc.bind(null, ...inputs)).to.throw();
        } else {
          const profileId = `${description}-${Date.now()}.profile`;
          if (env.GEN_PROFILE_DIR) {
            profiler.startProfiling(profileId);
          }
          const result = testFunc(...inputs);
          if (env.GEN_PROFILE_DIR) {
            const profile = profiler.stopProfiling(profileId);
            const directory = env.GEN_PROFILE_DIR || __dirname;
            profile.export((error, result) => {
              if (error) {
                return;
              }
              writeFile(`${directory}/${profileId}`, result, () => {
                profile.delete();
              });
            });
          }
          const actual = getActual(result);
          const expected = getExpected(testCase);
          expectFunc(testCase, expect, expected, actual);
        }
      });

    });
  });
}
