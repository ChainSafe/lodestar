import path from "node:path";
import {expect} from "vitest";
import {ChainForkConfig, createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {testLogger} from "@lodestar/logger/test-utils";
import {ACTIVE_PRESET, BUILDER_INDEX_SELF_BUILD, ForkName, ForkPostGloas, isForkPostGloas} from "@lodestar/params";
import {InputType} from "@lodestar/spec-test-util";
import {
  BeaconStateAllForks,
  DataAvailabilityStatus,
  ExecutionPayloadStatus,
  IBeaconStateView,
  computeEpochAtSlot,
  getAttestingIndices,
} from "@lodestar/state-transition";
import {SignedBeaconBlock, ssz, sszTypesFor} from "@lodestar/types";
import {bnToNum} from "@lodestar/utils";
import {verifyBlocksSignatures} from "../../../src/chain/blocks/verifyBlocksSignatures.js";
import {BlsSingleThreadVerifier} from "../../../src/chain/bls/index.js";
import {BlockErrorCode} from "../../../src/chain/errors/index.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {expectEqualBeaconState, inputTypeSszTreeViewDU} from "../utils/expectEqualBeaconState.js";
import {
  createSpecTestMetrics,
  expectInvalidStateTransitionWithNoProgressiveBalancesMismatches,
  expectNoProgressiveBalancesMismatches,
} from "../utils/progressiveBalances.js";
import {specTestIterator} from "../utils/specTestIterator.js";
import {
  createBeaconStateViewForTest,
  replaceStateViewForTest,
  stateViewToBeaconState,
} from "../utils/stateTransition.js";
import {RunnerType, TestRunnerFn, shouldVerify} from "../utils/types.js";

const sanity: TestRunnerFn<any, BeaconStateAllForks | undefined> = (fork, testName, testSuite) => {
  switch (testName) {
    case "slots":
      return sanitySlots(fork, testName, testSuite);
    case "blocks":
      return sanityBlocks(fork, testName, testSuite);
    default:
      throw Error(`Unknown sanity test ${testName}`);
  }
};

const sanitySlots: TestRunnerFn<SanitySlotsTestCase, BeaconStateAllForks | undefined> = (fork) => {
  return {
    testFunction: async (testcase, _directoryName, testCaseName) => {
      let state = createBeaconStateViewForTest(fork, testcase.pre);
      const {metrics, register} = createSpecTestMetrics();
      const runProcessSlots = (): void => {
        state = replaceStateViewForTest(state, (preState) =>
          preState.processSlots(preState.slot + bnToNum(testcase.slots), {}, {metrics})
        );
      };

      if (testcase.post === undefined) {
        await expectInvalidStateTransitionWithNoProgressiveBalancesMismatches(runProcessSlots, register, testCaseName);
        return undefined;
      }

      runProcessSlots();
      await expectNoProgressiveBalancesMismatches(register, testCaseName);
      return stateViewToBeaconState(fork, state);
    },
    options: {
      inputTypes: {...inputTypeSszTreeViewDU, slots: InputType.YAML},
      sszTypes: {
        pre: ssz[fork].BeaconState,
        post: ssz[fork].BeaconState,
      },
      timeout: 30000,
      getExpected: (testCase) => testCase.post,
      expectFunc: (_testCase, expected, actual) => {
        if (expected === undefined) {
          expect(actual).toBeUndefined();
          return;
        }
        expectEqualBeaconState(fork, expected, actual);
      },
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/utils/specTestIterator.ts
    },
  };
};

const sanityBlocks: TestRunnerFn<SanityBlocksTestCase, BeaconStateAllForks | undefined> = (fork) => {
  return {
    testFunction: async (testcase, _directoryName, testCaseName) => {
      const config = getConfig(fork);
      let state = createBeaconStateViewForTest(fork, testcase.pre, config);
      const {metrics, register} = createSpecTestMetrics();
      const verify = shouldVerify(testcase);
      const runStateTransition = (): void => {
        for (let i = 0; i < testcase.meta.blocks_count; i++) {
          const signedBlock = testcase[`blocks_${i}`] as SignedBeaconBlock;

          state = replaceStateViewForTest(state, (preState) =>
            preState.stateTransition(
              {block: signedBlock},
              {
                // Assume valid and available for this test
                executionPayloadStatus: ExecutionPayloadStatus.valid,
                dataAvailabilityStatus: DataAvailabilityStatus.Available,
                // Always verify the state root, it is not gated by bls_setting
                verifyStateRoot: true,
                verifyProposer: verify,
                verifySignatures: verify,
              },
              {metrics}
            )
          );
        }
      };

      if (testcase.post === undefined) {
        await expectInvalidStateTransitionWithNoProgressiveBalancesMismatches(
          runStateTransition,
          register,
          testCaseName
        );
        return undefined;
      }

      if (isForkPostGloas(fork)) {
        const builderBidBlocks = await expectForgedBuilderBidRejectedOnImport(fork, config, testcase);
        if (BUILDER_BID_TEST_CASES.includes(testCaseName)) {
          expect(builderBidBlocks).toBeGreaterThan(0);
        }
      }

      runStateTransition();
      await expectNoProgressiveBalancesMismatches(register, testCaseName);
      return stateViewToBeaconState(fork, state);
    },
    options: {
      inputTypes: inputTypeSszTreeViewDU,
      sszTypes: {
        pre: ssz[fork].BeaconState,
        post: ssz[fork].BeaconState,
        ...generateBlocksSZZTypeMapping(fork, 99),
      },
      // Only an ssz list limit violation is an expected input error, anything else is a decode bug
      shouldErrorOnInput: (error: Error, inputNames: Set<string>) =>
        !inputNames.has("post") && /over limit/.test(error.message),
      timeout: 10000,
      getExpected: (testCase) => testCase.post,
      expectFunc: (_testCase, expected, actual) => {
        if (expected === undefined) {
          expect(actual).toBeUndefined();
          return;
        }
        expectEqualBeaconState(fork, expected, actual);
      },
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/utils/specTestIterator.ts
    },
  };
};

/** Vectors with a builder bid. The import check below must find one in each, so it cannot pass by checking nothing */
const BUILDER_BID_TEST_CASES = [
  "builder_payment_after_missed_epochs",
  "builder_payment_removed_when_proposer_slashes_itself",
];

/**
 * Block import runs the state transition with `verifySignatures: false` and verifies the signatures of the block
 * in a batch. The spec vectors only exercise the state transition, so run both steps of the import here for every
 * block with a builder bid, and check that the batch rejects the block when the bid signature is forged.
 *
 * Returns the number of blocks with a builder bid.
 */
async function expectForgedBuilderBidRejectedOnImport(
  fork: ForkPostGloas,
  chainConfig: ChainForkConfig,
  testcase: SanityBlocksTestCase
): Promise<number> {
  const blocks: SignedBeaconBlock<ForkPostGloas>[] = [];
  for (let i = 0; i < testcase.meta.blocks_count; i++) {
    blocks.push(testcase[`blocks_${i}`] as SignedBeaconBlock<ForkPostGloas>);
  }
  const hasBuilderBid = (block: SignedBeaconBlock<ForkPostGloas>): boolean =>
    block.message.body.signedExecutionPayloadBid.message.builderIndex !== BUILDER_INDEX_SELF_BUILD;
  if (!blocks.some(hasBuilderBid)) {
    return 0;
  }

  const config = createBeaconConfig(chainConfig, testcase.pre.genesisValidatorsRoot);
  const bls = new BlsSingleThreadVerifier({metrics: null});
  const logger = testLogger("sanity");

  const verifySignatures = async (
    preState: IBeaconStateView,
    block: SignedBeaconBlock<ForkPostGloas>
  ): Promise<void> => {
    const shufflings = block.message.body.attestations.map((attestation) =>
      preState.getShufflingAtEpoch(computeEpochAtSlot(attestation.data.slot))
    );
    const indexedAttestations = block.message.body.attestations.map((attestation, i) => ({
      attestingIndices: getAttestingIndices(shufflings[i], preState.forkSeq, attestation),
      data: attestation.data,
      signature: attestation.signature,
    }));
    await verifyBlocksSignatures(config, bls, logger, null, preState, [block], [indexedAttestations], [shufflings], {
      // Forging the bid signature changes the block root, so the proposer signature of the vector no longer matches.
      // Skip it, as import does for a gossip block, to leave the bid as the only signature that can fail
      validProposerSignature: true,
    });
  };

  let builderBidBlocks = 0;
  let state = createBeaconStateViewForTest(fork, testcase.pre, chainConfig);
  for (const block of blocks) {
    if (hasBuilderBid(block)) {
      builderBidBlocks++;
      // Import verifies signatures against a pre-state in the epoch of the block
      const isBlockEpoch = computeEpochAtSlot(state.slot) === computeEpochAtSlot(block.message.slot);
      const preState = isBlockEpoch ? state : state.processSlots(block.message.slot);
      try {
        await verifySignatures(preState, block);

        const forgedBlock = sszTypesFor(fork).SignedBeaconBlock.clone(block);
        // A valid signature, but not one of the builder over the bid
        forgedBlock.message.body.signedExecutionPayloadBid.signature = block.message.body.randaoReveal;
        await expect(
          verifySignatures(preState, forgedBlock),
          `forged builder bid at slot ${block.message.slot}`
        ).rejects.toMatchObject({type: {code: BlockErrorCode.INVALID_SIGNATURE}});
      } finally {
        if (preState !== state) preState.release();
      }
    }

    state = replaceStateViewForTest(state, (preState) =>
      preState.stateTransition(
        {block},
        {
          executionPayloadStatus: ExecutionPayloadStatus.valid,
          dataAvailabilityStatus: DataAvailabilityStatus.Available,
          verifyStateRoot: true,
          verifyProposer: false,
          verifySignatures: false,
        },
        {}
      )
    );
  }
  state.release();

  return builderBidBlocks;
}

type BlocksSZZTypeMapping = Record<string, (typeof ssz)[ForkName]["SignedBeaconBlock"]>;

export function generateBlocksSZZTypeMapping(fork: ForkName, n: number): BlocksSZZTypeMapping {
  const blocksMapping: BlocksSZZTypeMapping = {};
  for (let i = 0; i < n; i++) {
    blocksMapping[`blocks_${i}`] = ssz[fork].SignedBeaconBlock;
  }
  return blocksMapping;
}

type SanityBlocksTestCase = {
  [k: string]: SignedBeaconBlock | unknown | null | undefined;
  meta: {
    blocks_count: number;
    bls_setting: bigint;
  };
  pre: BeaconStateAllForks;
  post?: BeaconStateAllForks;
};

type SanitySlotsTestCase = {
  meta?: any;
  pre: BeaconStateAllForks;
  post?: BeaconStateAllForks;
  slots: bigint;
};

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  sanity: {type: RunnerType.default, fn: sanity},
  random: {type: RunnerType.default, fn: sanityBlocks},
});
