import {expect} from "vitest";
import {type Node, Tree} from "@chainsafe/persistent-merkle-tree";
import {CompositeType, Type} from "@chainsafe/ssz";
import {ForkName} from "@lodestar/params";
import {InputType} from "@lodestar/spec-test-util";
import {RootHex, ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {TestRunnerFn} from "../../utils/types.js";

// https://github.com/ethereum/consensus-specs/blob/da3f5af919be4abb5a6db5a80b235deb8b4b5cba/tests/formats/light_client/single_merkle_proof.md
type SingleMerkleProofTestCase = {
  meta?: unknown;
  object: TreeBackedObject | unknown;
  // leaf: Bytes32            # string, hex encoded, with 0x prefix
  // leaf_index: int          # integer, decimal
  // branch: list of Bytes32  # list, each element is a string, hex encoded, with 0x prefix
  proof: {
    leaf: RootHex;
    leaf_index: bigint;
    branch: RootHex[];
  };
};

export const singleMerkleProof: TestRunnerFn<SingleMerkleProofTestCase, RootHex[]> = (
  fork,
  _testHandler,
  testSuite
) => {
  return {
    testFunction: (testcase) => {
      // Assert correct proof generation
      const objectType = getObjectType(fork, testSuite);
      const node = isTreeBackedObject(testcase.object)
        ? testcase.object.node
        : toCompositeType(objectType).toViewDU(testcase.object).node;
      const branch = new Tree(node).getSingleProof(testcase.proof.leaf_index);
      return branch.map(toHex);
    },
    options: {
      inputTypes: {
        object: InputType.SSZ_SNAPPY,
        proof: InputType.YAML,
      },
      sszTypes: {
        object: getObjectType(fork, testSuite),
      },
      getExpected: (testCase) => testCase.proof.branch,
      expectFunc: (_testCase, expected, actual) => {
        expect(actual).deep.equals(expected);
      },
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    },
  };
};

function getObjectType(fork: ForkName, objectName: string): Type<unknown> {
  switch (objectName) {
    case "BeaconState":
      return ssz[fork].BeaconState;
    case "BeaconBlockBody":
      return ssz[fork].BeaconBlockBody;
    default:
      throw Error(`Unknown objectName ${objectName}`);
  }
}

type TreeBackedObject = {
  node: Node;
};

function isTreeBackedObject(object: unknown): object is TreeBackedObject {
  return typeof object === "object" && object !== null && "node" in object;
}

function toCompositeType(type: Type<unknown>): CompositeType<unknown, unknown, TreeBackedObject> {
  return type as CompositeType<unknown, unknown, TreeBackedObject>;
}
