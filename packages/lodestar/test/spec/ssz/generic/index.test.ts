import {expect} from "chai";
import path from "node:path";
import fs from "node:fs";
// eslint-disable-next-line no-restricted-imports
import {parseInvalidTestcase, parseValidTestcase} from "@chainsafe/lodestar-spec-test-util/lib/sszGeneric";
import {CompositeType, isCompositeType, toHexString, Type} from "@chainsafe/ssz";
import {SPEC_TEST_LOCATION} from "../../specTestVersioning";

// Test types defined here
import {getTestType} from "./types";

const rootGenericSszPath = path.join(SPEC_TEST_LOCATION, "tests", "general", "phase0", "ssz_generic");

// ssz_generic
// | basic_vector
//   | invalid
//     | vec_bool_0
//       | serialized.ssz_snappy
//   | valid
//     | vec_bool_1_max
//       | meta.yaml
//       | serialized.ssz_snappy
//       | value.yaml
//
// Docs: https://github.com/ethereum/eth2.0-specs/blob/master/tests/formats/ssz_generic/README.md

for (const testType of fs.readdirSync(rootGenericSszPath)) {
  const testTypePath = path.join(rootGenericSszPath, testType);

  describe(`${testType} invalid`, () => {
    const invalidCasesPath = path.join(testTypePath, "invalid");
    for (const invalidCase of fs.readdirSync(invalidCasesPath)) {
      it(invalidCase, () => {
        const type = getTestType(testType, invalidCase);
        const testData = parseInvalidTestcase(path.join(invalidCasesPath, invalidCase));

        // Unlike the valid suite, invalid encodings do not have any value or hash tree root. The serialized data
        // should simply not be decoded without raising an error.
        // Note that for some type declarations in the invalid suite, the type itself may technically be invalid.
        // This is a valid way of detecting invalid data too. E.g. a 0-length basic vector.
        expect(() => type.deserialize(testData.serialized), "Must throw on deserialize").to.throw();
      });
    }
  });

  describe(`${testType} valid`, () => {
    const validCasesPath = path.join(testTypePath, "valid");
    for (const validCase of fs.readdirSync(validCasesPath)) {
      // NOTE: ComplexTestStruct tests are not correctly generated.
      // where deserialized .d value is D: '0x00'. However the tests guide mark that field as D: Bytes[256].
      // Those test won't be fixed since most implementations staticly compile types.
      if (validCase.startsWith("ComplexTestStruct")) {
        continue;
      }

      it(validCase, () => {
        const type = getTestType(testType, validCase);

        const testData = parseValidTestcase(path.join(validCasesPath, validCase), type);
        const testDataSerialized = toHexString(testData.serialized);
        const testDataRoot = testData.root;

        const serialized = wrapErr(() => type.serialize(testData.value), "type.serialize()");
        const value = wrapErr(() => type.deserialize(testData.serialized), "type.deserialize()");
        const root = wrapErr(() => type.hashTreeRoot(testData.value), "type.hashTreeRoot()");
        const valueSerdes = wrapErr(() => type.deserialize(serialized), "type.deserialize(serialized)");

        expect(valueSerdes).to.deep.equal(testData.value, "round trip serdes");
        expect(toHexString(serialized)).to.equal(testDataSerialized, "struct serialize");
        expect(value).to.deep.equal(testData.value, "struct deserialize");
        expect(toHexString(root)).to.equal(testDataRoot, "struct hashTreeRoot");

        // If the type is composite, test tree-backed ops
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!isCompositeType(type as Type<any>)) return;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const compositeType = type as CompositeType<any>;

        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const treebackedValue = compositeType.createTreeBackedFromStruct(testData.value);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
        const treeToStruct = compositeType.tree_convertToStruct(treebackedValue.tree);

        expect(treeToStruct).to.deep.equal(testData.value, "tree-backed to struct");
        expect(type.equals(testData.value, treebackedValue), "struct - tree-backed type.equals()").to.be.true;
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        expect(toHexString(treebackedValue.serialize())).to.equal(testDataSerialized, "tree-backed serialize");
        // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-unsafe-call
        expect(toHexString(treebackedValue.hashTreeRoot())).to.equal(testDataRoot, "tree-backed hashTreeRoot");
      });
    }
  });
}

function wrapErr<T>(fn: () => T, prefix: string): T {
  try {
    return fn();
  } catch (e) {
    (e as Error).message = `${prefix}: ${(e as Error).message}`;
    throw e;
  }
}
