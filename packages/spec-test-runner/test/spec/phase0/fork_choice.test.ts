import {join} from "path";
import {expect} from "chai";
import {createCachedBeaconState, phase0, allForks} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
// eslint-disable-next-line no-restricted-imports
import {initializeForkChoice} from "@chainsafe/lodestar/lib/chain/forkChoice";
// eslint-disable-next-line no-restricted-imports
import {ChainEventEmitter} from "@chainsafe/lodestar/lib/chain/emitter";
import {ACTIVE_PRESET, PresetName} from "@chainsafe/lodestar-params";
import {toHexString} from "@chainsafe/ssz";
import {ssz} from "@chainsafe/lodestar-types";
import {SPEC_TEST_LOCATION} from "../../specTestVersioning";
import {IBaseSpecTest} from "../type";
import {config} from "./util";

const ANCHOR_STATE_FILE_NAME = "anchor_state";
const ANCHOR_BLOCK_FILE_NAME = "anchor_block";
const BLOCK_FILE_NAME = "^(block)_([0-9a-zA-Z]+)$";
const ATTESTATION_FILE_NAME = "^(attestation)_([0-9a-zA-Z])+$";

describeDirectorySpecTest<IForkChoiceTestCase, void>(
  `${ACTIVE_PRESET}/phase0/fork_choice/get_head`,
  join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/phase0/fork_choice/get_head/pyspec_tests`),
  (testcase) => {
    const emitter = new ChainEventEmitter();
    const {steps, anchorState} = testcase;
    const currentSlot = anchorState.slot;
    const tbState = config.getForkTypes(currentSlot).BeaconState.createTreeBackedFromStruct(anchorState);
    let cachedState = createCachedBeaconState(config, tbState);
    const forkchoice = initializeForkChoice(config, emitter, currentSlot, cachedState);
    const {SECONDS_PER_SLOT} = cachedState.config;
    for (const step of steps) {
      if (isTick(step)) {
        forkchoice.updateTime(Number(step.tick) / SECONDS_PER_SLOT);
      } else if (isAttestation(step)) {
        const attestation = testcase.attestations.get(step.attestation);
        if (!attestation) throw Error(`No attestation ${step.attestation}`);
        forkchoice.onAttestation(cachedState.epochCtx.getIndexedAttestation(attestation));
      } else if (isBlock(step)) {
        const signedBlock = testcase.blocks.get(step.block);
        if (!signedBlock) throw Error(`No block ${step.block}`);
        expect(signedBlock).not.to.be.undefined;
        try {
          cachedState = allForks.stateTransition(cachedState, signedBlock, {
            verifyStateRoot: false,
            verifyProposer: false,
            verifySignatures: false,
          });
        } catch (e) {
          // some tests add old blocks, allForksStateTransition should throw error but this is fine
        }

        forkchoice.onBlock(signedBlock.message, cachedState);
      } else if (isCheck(step)) {
        const {
          head: expectedHead,
          time: expectedTime,
          justifiedCheckpointRoot,
          finalizedCheckpointRoot,
          bestJustifiedCheckpoint,
        } = step.checks;
        const head = forkchoice.updateHead();
        expect(head.slot).to.be.equal(Number(expectedHead.slot));
        expect(head.blockRoot).to.be.equal(expectedHead.root);
        // time in spec mapped to Slot in our forkchoice implementation
        if (expectedTime) expect(forkchoice.getTime() * SECONDS_PER_SLOT).to.be.equal(Number(expectedTime));
        if (justifiedCheckpointRoot)
          expect(toHexString(forkchoice.getJustifiedCheckpoint().root)).to.be.equal(justifiedCheckpointRoot);
        if (finalizedCheckpointRoot)
          expect(toHexString(forkchoice.getFinalizedCheckpoint().root)).to.be.equal(finalizedCheckpointRoot);
        if (bestJustifiedCheckpoint)
          expect(toHexString(forkchoice.getBestJustifiedCheckpoint().root)).to.be.equal(bestJustifiedCheckpoint);
      }
    }
  },
  {
    inputTypes: {
      meta: InputType.YAML,
      steps: InputType.YAML,
    },
    sszTypes: {
      [ANCHOR_STATE_FILE_NAME]: ssz.phase0.BeaconState,
      [ANCHOR_BLOCK_FILE_NAME]: ssz.phase0.BeaconBlock,
      [BLOCK_FILE_NAME]: ssz.phase0.SignedBeaconBlock,
      [ATTESTATION_FILE_NAME]: ssz.phase0.Attestation,
    },
    mapToTestCase: (t: Record<string, any>) => {
      // t has input file name as key
      const blocks = new Map<string, phase0.SignedBeaconBlock>();
      const attestations = new Map<string, phase0.Attestation>();
      for (const key in t) {
        const blockMatch = key.match(BLOCK_FILE_NAME);
        if (blockMatch) {
          blocks.set(key, t[key]);
        }
        const attMatch = key.match(ATTESTATION_FILE_NAME);
        if (attMatch) {
          attestations.set(key, t[key]);
        }
      }
      return {
        meta: t["meta"] as IForkChoiceTestCase["meta"],
        anchorState: t[ANCHOR_STATE_FILE_NAME] as IForkChoiceTestCase["anchorState"],
        anchorBlock: t[ANCHOR_BLOCK_FILE_NAME] as IForkChoiceTestCase["anchorBlock"],
        steps: t["steps"] as IForkChoiceTestCase["steps"],
        blocks,
        attestations,
      };
    },
    timeout: 10000000,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    expectFunc: () => {},
    shouldSkip: (testCase, n) =>
      // TODO: Test case below errors with
      //
      // Error: FORKCHOICE_ERROR_UNABLE_TO_SET_JUSTIFIED_CHECKPOINT
      // at LodestarForkChoice.onBlock (/home/lion/Code/eth2.0/lodestar/packages/fork-choice/src/forkChoice/forkChoice.ts:328:15)
      // at lodestar_spec_test_util_1.describeDirectorySpecTest.inputTypes.meta (test/spec/phase0/fork_choice.test.ts:53:20)
      // at Context.<anonymous> (/home/lion/Code/eth2.0/lodestar/packages/spec-test-util/src/single.ts:144:22)
      ACTIVE_PRESET === PresetName.minimal && n === "filtered_block_tree",
  }
);

interface IForkChoiceTestCase extends IBaseSpecTest {
  meta?: {
    description?: string;
    blsSetting: BigInt;
  };
  anchorState: phase0.BeaconState;
  anchorBlock: phase0.BeaconBlock;
  steps: Step[];
  blocks: Map<string, phase0.SignedBeaconBlock>;
  attestations: Map<string, phase0.Attestation>;
}

function isTick(step: Step): step is IOnTick {
  return (step as IOnTick).tick > 0;
}

function isAttestation(step: Step): step is IOnAttestation {
  return typeof (step as IOnAttestation).attestation === "string";
}

function isBlock(step: Step): step is IOnBlock {
  return typeof (step as IOnBlock).block === "string";
}

function isCheck(step: Step): step is IChecks {
  return typeof (step as IChecks).checks === "object";
}

type Step = IOnTick | IOnAttestation | IOnBlock | IChecks;

interface IOnTick {
  tick: number;
}

interface IOnAttestation {
  attestation: string;
}

interface IOnBlock {
  block: string;
}

interface IChecks {
  checks: {
    head: {slot: number; root: string};
    time?: number;
    justifiedCheckpointRoot?: string;
    finalizedCheckpointRoot?: string;
    bestJustifiedCheckpoint?: string;
  };
}
