import {expect} from "vitest";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {TreeViewDU, Type} from "@chainsafe/ssz";
import {RootHex, ssz} from "@lodestar/types";
import {InputType} from "@lodestar/spec-test-util";
import {ForkName} from "@lodestar/params";
import {toHex} from "@lodestar/utils";
import {TestRunnerFn} from "../../utils/types.js";

/* eslint-disable @typescript-eslint/naming-convention */

// https://github.com/ethereum/consensus-specs/blob/da3f5af919be4abb5a6db5a80b235deb8b4b5cba/tests/formats/light_client/single_merkle_proof.md
type SingleMerkleProofTestCase = {
  meta?: any;
  object: TreeViewDU<any>;
  // leaf: Bytes32            # string, hex encoded, with 0x prefix
  // leaf_index: int          # integer, decimal
  // branch: list of Bytes32  # list, each element is a string, hex encoded, with 0x prefix
  proof: {
    leaf: RootHex;
    leaf_index: bigint;
    branch: RootHex[];
  };
};

export const singleMerkleProof: TestRunnerFn<SingleMerkleProofTestCase, RootHex[]> = (fork, testHandler, testSuite) => {
  return {
    testFunction: (testcase) => {
      // Assert correct proof generation
      const branch = new Tree(testcase.object.node).getSingleProof(testcase.proof.leaf_index);
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
      expectFunc: (testCase, expected, actual) => {
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
