import fs from "node:fs";
import path from "node:path";
import {expect} from "chai";
import {TestRunnerCustom} from "../utils/types.js";
import {parseSszGenericInvalidTestcase, parseSszGenericValidTestcase} from "../utils/sszTestCaseParser.js";
import {runValidSszTest} from "../utils/runValidSszTest.js";
import {getTestType} from "./ssz_generic_types.js";

/* eslint-disable @typescript-eslint/naming-convention */

// Mapping of sszGeneric() fn arguments to the path in spec tests
//
//       / config  / fork   / test runner      / test handler / test suite   / test case
//
// tests / general / phase0 / ssz_generic      / basic_vector / valid        / vec_bool_1_max/meta.yaml
//

export const sszGeneric: TestRunnerCustom = (fork, typeName, testSuite, testSuiteDirpath) => {
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
      // NOTE: ComplexTestStruct tests are not correctly generated.
      // where deserialized .d value is D: '0x00'. However the tests guide mark that field as D: Bytes[256].
      // Those test won't be fixed since most implementations staticly compile types.
      if (testCase.startsWith("ComplexTestStruct")) {
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
