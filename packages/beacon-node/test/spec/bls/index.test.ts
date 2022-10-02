import fs from "node:fs";
import path from "node:path";
import jsyaml from "js-yaml";
import {expect} from "chai";
import {blsSpecTests} from "../specTestVersioning.js";
import {readdirSyncSpec} from "../utils/specTestIterator.js";
import {testFnByType} from "./bls.js";

/* eslint-disable @typescript-eslint/naming-convention */

/**
 * File path structure:
 * ```
 * spec-tests-bls/
 *   <testRunner>   [aggregate, deserialization_G1]
 *     <testCase>
 * ```
 *
 * Examples
 * ```
 * spec-tests-bls / aggregate          / aggregate_0x0000000000000000000000000000000000000000000000000000000000000000.yaml
 * spec-tests-bls / deserialization_G1 / deserialization_fails_infinity_with_false_b_flag.yaml
 * ```
 */
for (const fnName of readdirSyncSpec(blsSpecTests.outputDir)) {
  describe(fnName, () => {
    const fn = testFnByType[fnName];
    if (fn === undefined) {
      throw Error(`No test runner for ${fnName}`);
    }

    const fnTestDirpath = path.join(blsSpecTests.outputDir, fnName);
    for (const testName of readdirSyncSpec(fnTestDirpath)) {
      it(`${fnName}/${testName}`, function () {
        if (fn === "skip") {
          this.skip();
          return;
        }

        const testData = jsyaml.load(fs.readFileSync(path.join(fnTestDirpath, testName), "utf8")) as BlsTestData;

        // Test format: https://github.com/ethereum/bls12-381-tests
        if (testData.output === null) {
          // Expect failure
          expect(() => fn(testData.input) as never).to.throw();
        } else {
          // Expect success
          expect(fn(testData.input)).to.deep.equals(testData.output);
        }
      });
    }
  });
}

type BlsTestData = {input: unknown; output: unknown};
