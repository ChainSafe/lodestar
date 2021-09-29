import {join} from "path";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
import {ProofType, SingleProof} from "@chainsafe/persistent-merkle-tree";
import {ACTIVE_PRESET} from "@chainsafe/lodestar-params";
import {fromHexString, toHexString, TreeBacked} from "@chainsafe/ssz";
import {SPEC_TEST_LOCATION} from "../../specTestVersioning";
import {IBaseSpecTest} from "../type";
import {verifyMerkleBranch} from "@chainsafe/lodestar-utils";
import {expect} from "chai";

describeDirectorySpecTest<IMerkleTestCase, IProof>(
  `${ACTIVE_PRESET}/altair/transition`,
  join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/altair/merkle/single_proof/pyspec_tests`),
  (testcase) => {
    const {proof: specTestProof, state} = testcase;
    const stateTB = state as TreeBacked<altair.BeaconState>;
    const stateRoot = stateTB.hashTreeRoot();
    const leaf = fromHexString(specTestProof.leaf);
    const branch = specTestProof.branch.map((item) => fromHexString(item));
    const depth = Math.floor(Math.log2(Number(specTestProof.leafIndex)));
    const verified = verifyMerkleBranch(leaf, branch, depth, Number(specTestProof.leafIndex) % 2 ** depth, stateRoot);
    expect(verified, "cannot verify merkle branch").to.be.true;
    const lodestarProof = stateTB.tree.getProof({
      gindex: specTestProof.leafIndex,
      type: ProofType.single,
    }) as SingleProof;
    return {
      leaf: toHexString(lodestarProof.leaf),
      leafIndex: lodestarProof.gindex,
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
        state: ssz.altair.BeaconState,
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
  state: altair.BeaconState;
  proof: IProof;
}

interface IProof {
  leaf: string;
  leafIndex: bigint;
  branch: string[];
}
