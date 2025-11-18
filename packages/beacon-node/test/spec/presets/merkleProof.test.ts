import path from "node:path";
import {expect} from "vitest";
import {Tree} from "@chainsafe/persistent-merkle-tree";
import {
  ACTIVE_PRESET,
  ForkPostDeneb,
  ForkPostFulu,
  ForkPreFulu,
  ForkPreGloas,
  isForkPostFulu,
  isForkPostGloas,
} from "@lodestar/params";
import {InputType} from "@lodestar/spec-test-util";
import {BeaconBlockBody, ssz, sszTypesFor} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {replaceUintTypeWithUintBigintType} from "../utils/replaceUintTypeWithUintBigintType.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {RunnerType, TestRunnerFn} from "../utils/types.js";

const merkleProof: TestRunnerFn<MerkleTestCase, {leaf: string; branch: string[]; leaf_index: bigint}> = (fork) => {
  return {
    testFunction: (testcase, _, testCaseName) => {
      // TODO Gloas: implement new test cases
      if (isForkPostGloas(fork)) {
        throw Error(`${testCaseName} not implemented for fork=${fork}`);
      }

      // Some of the specs in below conditions have uint(8 bytes) values greater than 2^53-1
      // This is causing clipping of integers during deserialization.
      // For testing purpose we replace the uint types with bigint
      const BeaconBlockBody =
        testCaseName.includes("random_block") ||
        testCaseName.endsWith("max_blobs") ||
        testCaseName.endsWith("multiple_blobs")
          ? replaceUintTypeWithUintBigintType(sszTypesFor(fork).BeaconBlockBody)
          : sszTypesFor(fork).BeaconBlockBody;

      const rawBody = testcase["object_raw"] as Uint8Array;
      const body = BeaconBlockBody.deserialize(rawBody);

      const leafIndex = isForkPostFulu(fork)
        ? BeaconBlockBody.getPathInfo(["blobKzgCommitments"]).gindex
        : BeaconBlockBody.getPathInfo(["blobKzgCommitments", 0]).gindex;

      const leaf = isForkPostFulu(fork)
        ? ssz.deneb.BlobKzgCommitments.hashTreeRoot(
            (body as BeaconBlockBody<ForkPostFulu & ForkPreGloas>).blobKzgCommitments
          )
        : ssz.deneb.KZGCommitment.hashTreeRoot(
            (body as BeaconBlockBody<ForkPostDeneb & ForkPreFulu>).blobKzgCommitments[0]
          );

      const bodyView = BeaconBlockBody.toView(body);
      const tree = new Tree(bodyView.node);
      const proof = tree.getSingleProof(leafIndex);

      return {leaf: toHex(leaf), branch: proof.map(toHex), leaf_index: leafIndex};
    },
    options: {
      inputTypes: {
        object: InputType.SSZ_SNAPPY,
        proof: InputType.YAML,
      },
      getSszTypes: () => ({
        object: sszTypesFor(fork).BeaconBlockBody,
      }),
      timeout: 10000,
      getExpected: (testCase) => testCase.proof,
      expectFunc: (_testCase, expected, actual) => {
        expect(actual.leaf).toEqual(expected.leaf);
        expect(actual.leaf_index).toEqual(expected.leaf_index);
        expect(actual.branch).toEqual(expected.branch);
      },
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    },
  };
};

type MerkleTestCase = {
  meta?: any;
  object: BeaconBlockBody;
  object_raw: Uint8Array;
  proof: IProof;
};

interface IProof {
  leaf: string;
  leaf_index: bigint;
  branch: string[];
}

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  merkle_proof: {type: RunnerType.default, fn: merkleProof},
});
