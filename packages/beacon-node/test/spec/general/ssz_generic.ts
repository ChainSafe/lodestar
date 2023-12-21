import fs from "node:fs";
import path from "node:path";
import {expect, describe, it} from "vitest";
import {TestRunnerCustom} from "../utils/types.js";
import {parseSszGenericInvalidTestcase, parseSszGenericValidTestcase} from "../utils/sszTestCaseParser.js";
import {runValidSszTest} from "../utils/runValidSszTest.js";
import {getTestType} from "./ssz_generic_types.js";

// Mapping of sszGeneric() fn arguments to the path in spec tests
//
//       / config  / fork   / test runner      / test handler / test suite   / test case
//
// tests / general / phase0 / ssz_generic      / basic_vector / valid        / vec_bool_1_max/meta.yaml
//

export const sszGeneric =
  (skippedTypes: string[]): TestRunnerCustom =>
  (fork, typeName, testSuite, testSuiteDirpath) => {
    if (testSuite === "invalid") {
      for (const testCase of fs.readdirSync(testSuiteDirpath)) {
        it(testCase, () => {
          // TODO: Strong type errors and assert that the entire it() throws known errors
          if (testCase.endsWith("_0")) {
            expect(() => getTestType(typeName, testSuite), "Must throw constructing type").to.throw();
            return;
          }

          const type = getTestType(typeName, testCase);
          const testData = parseSszGenericInvalidTestcase(path.join(testSuiteDirpath, testCase));

          /* eslint-disable no-console */
          if (process.env.DEBUG) {
            console.log({serialized: Buffer.from(testData.serialized).toString("hex")});
          }

          // Unlike the valid suite, invalid encodings do not have any value or hash tree root. The serialized data
          // should simply not be decoded without raising an error.
          // Note that for some type declarations in the invalid suite, the type itself may technically be invalid.
          // This is a valid way of detecting invalid data too. E.g. a 0-length basic vector.
          expect(() => type.deserialize(testData.serialized), "Must throw on deserialize").to.throw();
        });
      }
    } else if (testSuite === "valid") {
      for (const testCase of fs.readdirSync(testSuiteDirpath)) {
        // Do not manually skip tests here, do it in packages/beacon-node/test/spec/general/index.test.ts
        if (skippedTypes.some((skippedType) => testCase.startsWith(skippedType))) {
          continue;
        }

        it(testCase, () => {
          const type = getTestType(typeName, testCase);
          const testData = parseSszGenericValidTestcase(path.join(testSuiteDirpath, testCase));
          runValidSszTest(type, {
            root: testData.root,
            serialized: testData.serialized,
            jsonValue: testData.jsonValue,
          });
        });
      }
    } else {
      throw Error(`Unknown ssz_generic testSuite ${testSuite}`);
    }
  };
