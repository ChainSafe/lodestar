import {join} from "path";
import {expect} from "chai";
import {
  createCachedBeaconState,
  phase0,
  allForks,
  computeEpochAtSlot,
  CachedBeaconState,
  ZERO_HASH,
  getEffectiveBalances,
  computeStartSlotAtEpoch,
} from "@chainsafe/lodestar-beacon-state-transition";
import {describeDirectorySpecTest, InputType} from "@chainsafe/lodestar-spec-test-util";
// eslint-disable-next-line no-restricted-imports
import {initializeForkChoice} from "@chainsafe/lodestar/lib/chain/forkChoice";
// eslint-disable-next-line no-restricted-imports
import {
  CheckpointStateCache,
  toCheckpointHex,
} from "@chainsafe/lodestar/lib/chain/stateCache/stateContextCheckpointsCache";
// eslint-disable-next-line no-restricted-imports
import {ChainEventEmitter} from "@chainsafe/lodestar/lib/chain/emitter";
import {toHexString} from "@chainsafe/ssz";
import {CheckpointWithHex, IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {ssz} from "@chainsafe/lodestar-types";
import {ACTIVE_PRESET, SLOTS_PER_EPOCH, ForkName} from "@chainsafe/lodestar-params";
import {SPEC_TEST_LOCATION} from "../../specTestVersioning";
import {IBaseSpecTest} from "../type";
import {getConfig} from "./util";

const ANCHOR_STATE_FILE_NAME = "anchor_state";
const ANCHOR_BLOCK_FILE_NAME = "anchor_block";
const BLOCK_FILE_NAME = "^(block)_([0-9a-zA-Z]+)$";
const ATTESTATION_FILE_NAME = "^(attestation)_([0-9a-zA-Z])+$";

export function forkChoiceTest(fork: ForkName): void {
  for (const testFolder of ["get_head", "on_block"]) {
    describeDirectorySpecTest<IForkChoiceTestCase, void>(
      `${ACTIVE_PRESET}/${fork}/fork_choice/get_head`,
      join(SPEC_TEST_LOCATION, `/tests/${ACTIVE_PRESET}/${fork}/fork_choice/${testFolder}/pyspec_tests`),
      (testcase) => {
        const {steps, anchorState} = testcase;
        const currentSlot = anchorState.slot;
        const config = getConfig(fork);
        const tbState = config.getForkTypes(currentSlot).BeaconState.createTreeBackedFromStruct(anchorState);
        let state = createCachedBeaconState(config, tbState);

        const emitter = new ChainEventEmitter();
        const forkchoice = initializeForkChoice(config, emitter, currentSlot, state);

        const checkpointStateCache = new CheckpointStateCache({});
        const stateCache = new Map<string, CachedBeaconState<allForks.BeaconState>>();
        cacheState(state, stateCache);

        for (const [i, step] of steps.entries()) {
          if (isTick(step)) {
            forkchoice.updateTime(Number(step.tick) / config.SECONDS_PER_SLOT);
          }

          // attestation step
          else if (isAttestation(step)) {
            const attestation = testcase.attestations.get(step.attestation);
            if (!attestation) throw Error(`No attestation ${step.attestation}`);
            forkchoice.onAttestation(state.epochCtx.getIndexedAttestation(attestation));
          }

          // block step
          else if (isBlock(step)) {
            const signedBlock = testcase.blocks.get(step.block);
            if (!signedBlock) throw Error(`No block ${step.block}`);
            const preState = stateCache.get(toHexString(signedBlock.message.parentRoot));
            if (!preState) {
              continue;
              // should not throw error, on_block_bad_parent_root test wants this
            }
            state = runStateTranstion(preState, signedBlock, forkchoice, checkpointStateCache);
            cacheState(state, stateCache);
          }

          // checks step
          else if (isCheck(step)) {
            const {
              head: expectedHead,
              time: expectedTime,
              justifiedCheckpoint,
              finalizedCheckpoint,
              bestJustifiedCheckpoint,
            } = step.checks;

            // Forkchoice head is computed lazily only on request
            const head = forkchoice.updateHead();

            expect(head.slot).to.be.equal(Number(expectedHead.slot), `Invalid head slot at step ${i}`);
            expect(head.blockRoot).to.be.equal(expectedHead.root, `Invalid head root at step ${i}`);

            // time in spec mapped to Slot in our forkchoice implementation
            if (expectedTime !== undefined && expectedTime > 0)
              expect(forkchoice.getTime() * config.SECONDS_PER_SLOT).to.be.equal(
                Number(expectedTime),
                `Invalid forkchoice time at step ${i}`
              );
            if (justifiedCheckpoint) {
              expect(toSpecTestCheckpoint(forkchoice.getJustifiedCheckpoint())).to.be.deep.equal(
                justifiedCheckpoint,
                `Invalid justified checkpoint at step ${i}`
              );
            }
            if (finalizedCheckpoint) {
              expect(toSpecTestCheckpoint(forkchoice.getFinalizedCheckpoint())).to.be.deep.equal(
                finalizedCheckpoint,
                `Invalid finalized checkpoint at step ${i}`
              );
            }
            if (bestJustifiedCheckpoint) {
              expect(toSpecTestCheckpoint(forkchoice.getBestJustifiedCheckpoint())).to.be.deep.equal(
                bestJustifiedCheckpoint,
                `Invalid best justified checkpoint at step ${i}`
              );
            }
          }
        }
      },
      {
        inputTypes: {
          meta: InputType.YAML,
          steps: InputType.YAML,
        },
        sszTypes: {
          [ANCHOR_STATE_FILE_NAME]: ssz[fork].BeaconState,
          [ANCHOR_BLOCK_FILE_NAME]: ssz[fork].BeaconBlock,
          [BLOCK_FILE_NAME]: ssz[fork].SignedBeaconBlock,
          [ATTESTATION_FILE_NAME]: ssz.phase0.Attestation,
        },
        mapToTestCase: (t: Record<string, any>) => {
          // t has input file name as key
          const blocks = new Map<string, allForks.SignedBeaconBlock>();
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
  }
}

function runStateTranstion(
  preState: CachedBeaconState<allForks.BeaconState>,
  signedBlock: allForks.SignedBeaconBlock,
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
  let justifiedBalances: number[] = [];
  if (postState.currentJustifiedCheckpoint.epoch > forkchoice.getJustifiedCheckpoint().epoch) {
    const justifiedState = checkpointCache.get(toCheckpointHex(postState.currentJustifiedCheckpoint));
    if (!justifiedState) {
      const epoch = postState.currentJustifiedCheckpoint.epoch;
      const root = toHexString(postState.currentJustifiedCheckpoint.root);
      throw Error(`State not available for justified checkpoint ${epoch} ${root}`);
    }
    justifiedBalances = getEffectiveBalances(justifiedState);
  }
  try {
    forkchoice.onBlock(signedBlock.message, postState, {justifiedBalances});
    for (const attestation of signedBlock.message.body.attestations) {
      try {
        const indexedAttestation = postState.epochCtx.getIndexedAttestation(attestation);
        forkchoice.onAttestation(indexedAttestation);
        // eslint-disable-next-line no-empty
      } catch (e) {}
    }
    // eslint-disable-next-line no-empty
  } catch (e) {}
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

function toSpecTestCheckpoint(checkpoint: CheckpointWithHex): SpecTestCheckpoint {
  return {
    epoch: BigInt(checkpoint.epoch),
    root: checkpoint.rootHex,
  };
}

type Step = OnTick | OnAttestation | OnBlock | Checks;

type SpecTestCheckpoint = {epoch: BigInt; root: string};

// This test executes steps in sequence. There may be multiple items of the following types:
// on_tick execution step

type OnTick = {
  /** to execute `on_tick(store, time)` */
  tick: number;
  /** optional, default to `true`. */
  valid?: number;
};

type OnAttestation = {
  /** the name of the `attestation_<32-byte-root>.ssz_snappy` file. To execute `on_attestation(store, attestation)` */
  attestation: string;
  /** optional, default to `true`. */
  valid?: number;
};

type OnBlock = {
  /** the name of the `block_<32-byte-root>.ssz_snappy` file. To execute `on_block(store, block)` */
  block: string;
};

type Checks = {
  /** Value in the ForkChoice store to verify it's correct after being mutated by another step */
  checks: {
    head: {slot: number; root: string};
    time?: number;
    justifiedCheckpoint?: SpecTestCheckpoint;
    finalizedCheckpoint?: SpecTestCheckpoint;
    bestJustifiedCheckpoint?: SpecTestCheckpoint;
  };
};

interface IForkChoiceTestCase extends IBaseSpecTest {
  meta?: {
    description?: string;
    blsSetting: BigInt;
  };
  anchorState: allForks.BeaconState;
  anchorBlock: allForks.BeaconBlock;
  steps: Step[];
  blocks: Map<string, allForks.SignedBeaconBlock>;
  attestations: Map<string, phase0.Attestation>;
}

function isTick(step: Step): step is OnTick {
  return (step as OnTick).tick > 0;
}

function isAttestation(step: Step): step is OnAttestation {
  return typeof (step as OnAttestation).attestation === "string";
}

function isBlock(step: Step): step is OnBlock {
  return typeof (step as OnBlock).block === "string";
}

function isCheck(step: Step): step is Checks {
  return typeof (step as Checks).checks === "object";
}
