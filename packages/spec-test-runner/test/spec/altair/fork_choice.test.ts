import {join} from "path";
import {expect} from "chai";
import {
  createCachedBeaconState,
  phase0,
  allForks,
  altair,
  computeEpochAtSlot,
  CachedBeaconState,
  ZERO_HASH,
  computeStartSlotAtEpoch,
} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
// eslint-disable-next-line no-restricted-imports
import {LodestarForkChoice} from "@chainsafe/lodestar/lib/chain/forkChoice/forkChoice";
// eslint-disable-next-line no-restricted-imports
import {CheckpointStateCache} from "@chainsafe/lodestar/lib/chain/stateCache/stateContextCheckpointsCache";
// eslint-disable-next-line no-restricted-imports
import {ChainEventEmitter} from "@chainsafe/lodestar/lib/chain/emitter";
import {toHexString} from "@chainsafe/ssz";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {ssz} from "@chainsafe/lodestar-types";
import {ACTIVE_PRESET, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../../utils/specTestCases";
import {IBaseSpecTest} from "../type";
import {config} from "./util";

const ANCHOR_STATE_FILE_NAME = "anchor_state";
const ANCHOR_BLOCK_FILE_NAME = "anchor_block";
const BLOCK_FILE_NAME = "^(block)_([0-9a-zA-Z]+)$";
const ATTESTATION_FILE_NAME = "^(attestation)_([0-9a-zA-Z])+$";

describeDirectorySpecTest<IForkChoiceTestCase, void>(
  `${ACTIVE_PRESET}/altair/fork_choice/get_head`,
  join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/altair/fork_choice/get_head/pyspec_tests`),
  (testcase) => {
    const emitter = new ChainEventEmitter();
    const {steps, anchorState} = testcase;
    const currentSlot = anchorState.slot;
    const tbState = config.getForkTypes(currentSlot).BeaconState.createTreeBackedFromStruct(anchorState);
    let wrappedState = createCachedBeaconState(config, tbState);
    const forkchoice = new LodestarForkChoice({config, emitter, currentSlot, state: wrappedState});
    const checkpointStateCache = new CheckpointStateCache({});
    const stateCache = new Map<string, CachedBeaconState<allForks.BeaconState>>();
    cacheState(wrappedState, stateCache);
    const {SECONDS_PER_SLOT} = wrappedState.config;
    for (const [i, step] of steps.entries()) {
      if (isTick(step)) {
        forkchoice.updateTime(Number(step.tick) / SECONDS_PER_SLOT);
      } else if (isAttestation(step)) {
        const attestation = testcase.attestations.get(step.attestation);
        if (!attestation) throw Error(`No attestation ${step.attestation}`);
        forkchoice.onAttestation(wrappedState.epochCtx.getIndexedAttestation(attestation));
      } else if (isBlock(step)) {
        const signedBlock = testcase.blocks.get(step.block);
        if (!signedBlock) throw Error(`No block ${step.block}`);
        const preState = stateCache.get(toHexString(signedBlock.message.parentRoot));
        if (!preState)
          throw new Error("not found parent state for parent root" + toHexString(signedBlock.message.parentRoot));
        wrappedState = runStateTranstion(preState, signedBlock, forkchoice, checkpointStateCache);
        cacheState(wrappedState, stateCache);
      } else if (isCheck(step)) {
        const {
          head: expectedHead,
          time: expectedTime,
          justifiedCheckpointRoot,
          finalizedCheckpointRoot,
          bestJustifiedCheckpoint,
        } = step.checks;
        const head = forkchoice.updateHead();
        expect(head.slot).to.be.equal(Number(expectedHead.slot), `Invalid head slot at step ${i}`);
        expect(toHexString(head.blockRoot)).to.be.equal(expectedHead.root, `Invalid head root at step ${i}`);
        // time in spec mapped to Slot in our forkchoice implementation
        if (expectedTime)
          expect(forkchoice.getTime() * SECONDS_PER_SLOT).to.be.equal(
            Number(expectedTime),
            `Invalid forkchoice time at step ${i}`
          );
        if (justifiedCheckpointRoot)
          expect(toHexString(forkchoice.getJustifiedCheckpoint().root)).to.be.equal(
            justifiedCheckpointRoot,
            `Invalid justified checkpoint time at step ${i}`
          );
        if (finalizedCheckpointRoot)
          expect(toHexString(forkchoice.getFinalizedCheckpoint().root)).to.be.equal(
            finalizedCheckpointRoot,
            `Invalid finalized checkpoint time at step ${i}`
          );
        if (bestJustifiedCheckpoint)
          expect(toHexString(forkchoice.getBestJustifiedCheckpoint().root)).to.be.equal(
            bestJustifiedCheckpoint,
            `Invalid best justified checkpoint time at step ${i}`
          );
      }
    }
  },
  {
    inputTypes: {
      meta: InputType.YAML,
      steps: InputType.YAML,
    },
    sszTypes: {
      [ANCHOR_STATE_FILE_NAME]: ssz.altair.BeaconState,
      [ANCHOR_BLOCK_FILE_NAME]: ssz.altair.BeaconBlock,
      [BLOCK_FILE_NAME]: ssz.altair.SignedBeaconBlock,
      [ATTESTATION_FILE_NAME]: ssz.phase0.Attestation,
    },
    mapToTestCase: (t: Record<string, any>) => {
      // t has input file name as key
      const blocks = new Map<string, altair.SignedBeaconBlock>();
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
    timeout: 10000,
    // eslint-disable-next-line @typescript-eslint/no-empty-function
    expectFunc: () => {},
  }
);

function runStateTranstion(
  preState: CachedBeaconState<allForks.BeaconState>,
  signedBlock: altair.SignedBeaconBlock,
  forkchoice: IForkChoice,
  checkpointCache: CheckpointStateCache
): CachedBeaconState<allForks.BeaconState> {
  const preSlot = preState.slot;
  const postSlot = signedBlock.message.slot - 1;
  let preEpoch = computeEpochAtSlot(preSlot);
  let postState = preState.clone();
  for (
    let nextEpochSlot = computeStartSlotAtEpoch(preEpoch + 1);
    nextEpochSlot <= postSlot;
    nextEpochSlot += SLOTS_PER_EPOCH
  ) {
    postState = allForks.processSlots(postState, nextEpochSlot, null);
    cacheCheckpointState(postState, checkpointCache);
  }
  preEpoch = postState.currentShuffling.epoch;
  postState = allForks.stateTransition(postState, signedBlock, {
    verifyStateRoot: true,
    verifyProposer: false,
    verifySignatures: false,
  });
  const postEpoch = postState.currentShuffling.epoch;
  if (postEpoch > preEpoch) {
    cacheCheckpointState(postState, checkpointCache);
  }
  // same logic like in state transition https://github.com/ChainSafe/lodestar/blob/f6778740075fe2b75edf94d1db0b5691039cb500/packages/lodestar/src/chain/blocks/stateTransition.ts#L101
  let justifiedBalances: phase0.Gwei[] = [];
  if (postState.currentJustifiedCheckpoint.epoch > forkchoice.getJustifiedCheckpoint().epoch) {
    const justifiedState = checkpointCache.get(postState.currentJustifiedCheckpoint);
    if (!justifiedState) {
      const epoch = postState.currentJustifiedCheckpoint.epoch;
      const root = toHexString(postState.currentJustifiedCheckpoint.root);
      throw Error(`State not available for justified checkpoint ${epoch} ${root}`);
    }
    justifiedBalances = justifiedState.effectiveBalances.toArray();
  }
  forkchoice.onBlock(signedBlock.message, postState, justifiedBalances);
  return postState;
}

function cacheCheckpointState(
  checkpointState: CachedBeaconState<allForks.BeaconState>,
  checkpointCache: CheckpointStateCache
): void {
  const config = checkpointState.config;
  const slot = checkpointState.slot;
  if (slot % SLOTS_PER_EPOCH !== 0) {
    throw new Error(`Invalid checkpoint state slot ${checkpointState.slot}`);
  }
  const blockHeader = ssz.phase0.BeaconBlockHeader.clone(checkpointState.latestBlockHeader);
  if (ssz.Root.equals(blockHeader.stateRoot, ZERO_HASH)) {
    blockHeader.stateRoot = config.getForkTypes(slot).BeaconState.hashTreeRoot(checkpointState);
  }
  const cp: phase0.Checkpoint = {
    root: ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader),
    epoch: computeEpochAtSlot(slot),
  };
  checkpointCache.add(cp, checkpointState);
}

function cacheState(
  wrappedState: CachedBeaconState<allForks.BeaconState>,
  stateCache: Map<string, CachedBeaconState<allForks.BeaconState>>
): void {
  const blockHeader = ssz.phase0.BeaconBlockHeader.clone(wrappedState.latestBlockHeader);
  if (ssz.Root.equals(blockHeader.stateRoot, ZERO_HASH)) {
    blockHeader.stateRoot = wrappedState.hashTreeRoot();
  }
  const blockRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader);
  stateCache.set(toHexString(blockRoot), wrappedState);
}

interface IForkChoiceTestCase extends IBaseSpecTest {
  meta?: {
    description?: string;
    blsSetting: BigInt;
  };
  anchorState: altair.BeaconState;
  anchorBlock: altair.BeaconBlock;
  steps: Step[];
  blocks: Map<string, altair.SignedBeaconBlock>;
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
