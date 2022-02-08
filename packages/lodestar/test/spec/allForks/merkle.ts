import {join} from "node:path";
import {allForks, ssz} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {ProofType, SingleProof} from "@chainsafe/persistent-merkle-tree";
import {ACTIVE_PRESET, ForkName} from "@chainsafe/lodestar-params";
import {fromHexString, toHexString, TreeBacked} from "@chainsafe/ssz";
import {SPEC_TEST_LOCATION} from "../specTestVersioning";
import {IBaseSpecTest} from "../type";
import {verifyMerkleBranch} from "@chainsafe/lodestar-utils";
import {expect} from "chai";

/* eslint-disable @typescript-eslint/naming-convention */

export function merkle(fork: ForkName): void {
  describeDirectorySpecTest<IMerkleTestCase, IProof>(
    `${ACTIVE_PRESET}/${fork}/transition`,
    join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/${fork}/merkle/single_proof/pyspec_tests`),
    (testcase) => {
      const {proof: specTestProof, state} = testcase;
      const stateTB = state as TreeBacked<allForks.BeaconState>;
      const stateRoot = stateTB.hashTreeRoot();
      const leaf = fromHexString(specTestProof.leaf);
      const branch = specTestProof.branch.map((item) => fromHexString(item));
      const leafIndex = Number(specTestProof.leaf_index);
      const depth = Math.floor(Math.log2(leafIndex));
      const verified = verifyMerkleBranch(leaf, branch, depth, leafIndex % 2 ** depth, stateRoot);
      expect(verified, "cannot verify merkle branch").to.be.true;
      const lodestarProof = stateTB.tree.getProof({
        gindex: specTestProof.leaf_index,
        type: ProofType.single,
      }) as SingleProof;
      return {
        leaf: toHexString(lodestarProof.leaf),
        leaf_index: lodestarProof.gindex,
        branch: lodestarProof.witnesses.map(toHexString),
      };
    },
    {
      inputTypes: {
        state: {type: InputType.SSZ_SNAPPY as const, treeBacked: true as const},
        proof: InputType.YAML as const,
      },
      getSszTypes: () => {
        return {
          state: ssz[fork].BeaconState,
        };
      },
      timeout: 10000,
      getExpected: (testCase) => testCase.proof,
      expectFunc: (testCase, expected, actual) => {
        expect(actual).to.be.deep.equal(expected, "incorrect proof");
      },
    }
  );

  interface IMerkleTestCase extends IBaseSpecTest {
    state: allForks.BeaconState;
    proof: IProof;
  }

  interface IProof {
    leaf: string;
    leaf_index: bigint;
    branch: string[];
  }
}
