import {expect} from "chai";
import {join} from "path";
// eslint-disable-next-line no-restricted-imports
import {getInvalidTestcases, getValidTestcases} from "@chainsafe/lodestar-spec-test-util/lib/sszGeneric";
import {CompositeValue, isCompositeType} from "@chainsafe/ssz";

// Test types defined here
import {types} from "./types";

for (const type of types) {
  // valid testcases
  describe(`ssz generic - valid - ${type.prefix}`, () => {
    for (const testcase of getValidTestcases(join(type.path, "valid"), type.prefix, type.type)) {
      it(`${testcase.path.split("/").pop()}`, () => {
        // test struct round trip serialization/deserialization
        expect(
          type.type.deserialize(type.type.serialize(testcase.value)),
          "Invalid struct round-trip serialization/deserialization"
        ).to.deep.equal(testcase.value);

        // test struct serialization
        expect(type.type.serialize(testcase.value), "Invalid struct serialization").to.deep.equal(testcase.serialized);

        // test deserialization to struct
        expect(type.type.deserialize(testcase.serialized), "Invalid deserialization to struct").to.deep.equal(
          testcase.value
        );

        // test struct merkleization
        expect(type.type.hashTreeRoot(testcase.value), "Invalid struct merkleization").to.deep.equal(testcase.root);

        // If the type is composite, test tree-backed ops
        if (isCompositeType(type.type)) {
          const structValue = testcase.value as CompositeValue;
          const treebackedValue = type.type.createTreeBackedFromStruct(structValue);

          // test struct / tree-backed equality
          expect(type.type.equals(structValue, treebackedValue), "Struct and tree-backed not equal").to.be.true;

          // test tree-backed to struct
          expect(
            type.type.tree_convertToStruct(treebackedValue.tree),
            "Tree-backed to struct conversion resulted in unequal value"
          ).to.deep.equal(structValue);

          // test tree-backed serialization
          expect(treebackedValue.serialize(), "Invalid tree-backed serialization").to.deep.equal(testcase.serialized);

          // test deserialization to tree-backed
          expect(
            type.type.tree_convertToStruct(type.type.tree_deserialize(testcase.serialized)),
            "Invalid deserialization to tree-backed"
          ).to.deep.equal(structValue);

          // test tree-backed merkleization
          expect(treebackedValue.hashTreeRoot(), "Invalid tree-backed merkleization").to.deep.equal(testcase.root);
        }
      });
    }
  });

  // invalid testcases
  describe(`ssz generic - invalid - ${type.prefix}`, () => {
    for (const testcase of getInvalidTestcases(join(type.path, "invalid"), type.prefix)) {
      it(`${testcase.path.split("/").pop()}`, () => {
        // test struct round trip serialization/deserialization
        // eslint-disable-next-line @typescript-eslint/no-unsafe-return
        expect(() => type.type.deserialize(testcase.serialized), "Invalid data should error during deserialization").to
          .throw;
      });
    }
  });
}
