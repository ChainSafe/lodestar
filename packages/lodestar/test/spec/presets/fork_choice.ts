import {expect} from "chai";
import {
  phase0,
  allForks,
  computeEpochAtSlot,
  CachedBeaconStateAllForks,
  ZERO_HASH,
  getEffectiveBalanceIncrementsZeroInactive,
  computeStartSlotAtEpoch,
  EffectiveBalanceIncrements,
  BeaconStateAllForks,
  bellatrix,
} from "@chainsafe/lodestar-beacon-state-transition";
import {InputType} from "@chainsafe/lodestar-spec-test-util";
import {
  ChainEventEmitter,
  initializeForkChoice,
  CheckpointStateCache,
  toCheckpointHex,
  toCheckpointKey,
} from "../../../src/chain/index.js";
import {toHexString} from "@chainsafe/ssz";
import {
  CheckpointWithHex,
  ForkChoiceError,
  ForkChoiceErrorCode,
  IForkChoice,
  assertValidTerminalPowBlock,
  ExecutionStatus,
  PowBlockHex,
} from "@chainsafe/lodestar-fork-choice";
import {ssz, RootHex} from "@chainsafe/lodestar-types";
import {bnToNum} from "@chainsafe/lodestar-utils";
import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {testLogger} from "../../utils/logger.js";
import {getConfig} from "../utils/getConfig.js";
import {TestRunnerFn} from "../utils/types.js";

/* eslint-disable @typescript-eslint/naming-convention */

/* eslint-disable @typescript-eslint/naming-convention */

const ANCHOR_STATE_FILE_NAME = "anchor_state";
const ANCHOR_BLOCK_FILE_NAME = "anchor_block";
const BLOCK_FILE_NAME = "^(block)_([0-9a-zA-Z]+)$";
const POW_BLOCK_FILE_NAME = "^(pow_block)_([0-9a-zA-Z]+)$";
const ATTESTATION_FILE_NAME = "^(attestation)_([0-9a-zA-Z])+$";

const logger = testLogger("spec-test");

export const forkChoiceTest: TestRunnerFn<ForkChoiceTestCase, void> = (fork) => {
  return {
    testFunction: (testcase) => {
      const {steps, anchorState} = testcase;
      const currentSlot = anchorState.slot;
      const config = getConfig(fork);
      let state = createCachedBeaconStateTest(anchorState, config);

      const emitter = new ChainEventEmitter();
      const forkchoice = initializeForkChoice(config, emitter, currentSlot, state, true);

      const checkpointStateCache = new CheckpointStateCache({});
      const stateCache = new Map<string, CachedBeaconStateAllForks>();
      cacheState(state, stateCache);

      /** This is to track test's tickTime to be used in proposer boost */
      let tickTime = 0;

      for (const [i, step] of steps.entries()) {
        if (isTick(step)) {
          tickTime = bnToNum(step.tick);
          const currentSlot = Math.floor(tickTime / config.SECONDS_PER_SLOT);
          logger.debug("Step tick", {currentSlot, valid: Boolean(step.valid), time: tickTime});
          forkchoice.updateTime(currentSlot);
        }

        // attestation step
        else if (isAttestation(step)) {
          logger.debug("Step attestation", {root: step.attestation, valid: Boolean(step.valid)});
          const attestation = testcase.attestations.get(step.attestation);
          if (!attestation) throw Error(`No attestation ${step.attestation}`);
          forkchoice.onAttestation(state.epochCtx.getIndexedAttestation(attestation));
        }

        // block step
        else if (isBlock(step)) {
          logger.debug("Step block", {root: step.block, valid: Boolean(step.valid)});
          const validBlock = Boolean(step.valid ?? true);

          const signedBlock = testcase.blocks.get(step.block);
          if (!signedBlock) throw Error(`No block ${step.block}`);

          // Log the BeaconBlock root instead of the SignedBeaconBlock root, forkchoice references BeaconBlock roots
          const blockRoot = config.getForkTypes(signedBlock.message.slot).BeaconBlock.hashTreeRoot(signedBlock.message);
          logger.debug("Step block", {slot: signedBlock.message.slot, root: toHexString(blockRoot)});

          const preState = stateCache.get(toHexString(signedBlock.message.parentRoot));
          if (!preState) {
            continue;
            // should not throw error, on_block_bad_parent_root test wants this
          }
          const blockDelaySec = (tickTime - preState.genesisTime) % config.SECONDS_PER_SLOT;
          const isMergeTransitionBlock =
            bellatrix.isBellatrixStateType(preState) &&
            bellatrix.isBellatrixBlockBodyType(signedBlock.message.body) &&
            bellatrix.isMergeTransitionBlock(preState, signedBlock.message.body);

          try {
            if (isMergeTransitionBlock) {
              const mergeBlock = signedBlock.message as bellatrix.BeaconBlock;

              const powBlockRootHex = toHexString(mergeBlock.body.executionPayload.parentHash);
              const powBlock = serializePowBlock(testcase.powBlocks.get(`pow_block_${powBlockRootHex}`));
              const powBlockParent = serializePowBlock(
                powBlock && testcase.powBlocks.get(`pow_block_${powBlock.parentHash}`)
              );
              assertValidTerminalPowBlock(config, mergeBlock, {
                executionStatus: powBlock !== undefined ? ExecutionStatus.Valid : ExecutionStatus.Syncing,
                powBlock,
                powBlockParent,
              });
            }

            state = runStateTranstion(preState, signedBlock, forkchoice, checkpointStateCache, blockDelaySec);
            // TODO: May be part of runStateTranstion, necessary to commit again?
            state.commit();
            cacheState(state, stateCache);
          } catch (e) {
            if (validBlock) throw e;
          }
        }

        // checks step
        else if (isCheck(step)) {
          // Forkchoice head is computed lazily only on request
          const head = forkchoice.updateHead();
          const proposerBootRoot = forkchoice.getProposerBoostRoot();

          if (step.checks.head !== undefined) {
            expect(head.slot).to.be.equal(bnToNum(step.checks.head.slot), `Invalid head slot at step ${i}`);
            expect(head.blockRoot).to.be.equal(step.checks.head.root, `Invalid head root at step ${i}`);
          }
          if (step.checks.proposer_boost_root !== undefined) {
            expect(proposerBootRoot).to.be.equal(
              step.checks.proposer_boost_root,
              `Invalid proposer boost root at step ${i}`
            );
          }
          // time in spec mapped to Slot in our forkchoice implementation.
          // Compare in slots because proposer boost steps doesn't always come on
          // slot boundary.
          if (step.checks.time !== undefined && step.checks.time > 0)
            expect(forkchoice.getTime()).to.be.equal(
              Math.floor(bnToNum(step.checks.time) / config.SECONDS_PER_SLOT),
              `Invalid forkchoice time at step ${i}`
            );
          if (step.checks.justified_checkpoint) {
            expect(toSpecTestCheckpoint(forkchoice.getJustifiedCheckpoint())).to.be.deep.equal(
              step.checks.justified_checkpoint,
              `Invalid justified checkpoint at step ${i}`
            );
          }
          if (step.checks.finalized_checkpoint) {
            expect(toSpecTestCheckpoint(forkchoice.getFinalizedCheckpoint())).to.be.deep.equal(
              step.checks.finalized_checkpoint,
              `Invalid finalized checkpoint at step ${i}`
            );
          }
          if (step.checks.best_justified_checkpoint) {
            expect(toSpecTestCheckpoint(forkchoice.getBestJustifiedCheckpoint())).to.be.deep.equal(
              step.checks.best_justified_checkpoint,
              `Invalid best justified checkpoint at step ${i}`
            );
          }
        }
      }
    },

    options: {
      inputTypes: {
        meta: InputType.YAML,
        steps: InputType.YAML,
      },
      sszTypes: {
        [ANCHOR_STATE_FILE_NAME]: ssz[fork].BeaconState,
        [ANCHOR_BLOCK_FILE_NAME]: ssz[fork].BeaconBlock,
        [BLOCK_FILE_NAME]: ssz[fork].SignedBeaconBlock,
        [POW_BLOCK_FILE_NAME]: ssz.bellatrix.PowBlock,
        [ATTESTATION_FILE_NAME]: ssz.phase0.Attestation,
      },
      mapToTestCase: (t: Record<string, any>) => {
        // t has input file name as key
        const blocks = new Map<string, allForks.SignedBeaconBlock>();
        const powBlocks = new Map<string, bellatrix.PowBlock>();
        const attestations = new Map<string, phase0.Attestation>();
        for (const key in t) {
          const blockMatch = key.match(BLOCK_FILE_NAME);
          if (blockMatch) {
            blocks.set(key, t[key]);
          }
          const powBlockMatch = key.match(POW_BLOCK_FILE_NAME);
          if (powBlockMatch) {
            powBlocks.set(key, t[key]);
          }
          const attMatch = key.match(ATTESTATION_FILE_NAME);
          if (attMatch) {
            attestations.set(key, t[key]);
          }
        }
        return {
          meta: t["meta"] as ForkChoiceTestCase["meta"],
          anchorState: t[ANCHOR_STATE_FILE_NAME] as ForkChoiceTestCase["anchorState"],
          anchorBlock: t[ANCHOR_BLOCK_FILE_NAME] as ForkChoiceTestCase["anchorBlock"],
          steps: t["steps"] as ForkChoiceTestCase["steps"],
          blocks,
          powBlocks,
          attestations,
        };
      },
      timeout: 10000,
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      expectFunc: () => {},
    },
  };
};

function runStateTranstion(
  preState: CachedBeaconStateAllForks,
  signedBlock: allForks.SignedBeaconBlock,
  forkchoice: IForkChoice,
  checkpointCache: CheckpointStateCache,
  blockDelaySec: number
): CachedBeaconStateAllForks {
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
  preEpoch = postState.epochCtx.epoch;
  postState = allForks.stateTransition(postState, signedBlock, {
    verifyStateRoot: true,
    verifyProposer: false,
    verifySignatures: false,
  });
  const postEpoch = postState.epochCtx.epoch;
  if (postEpoch > preEpoch) {
    cacheCheckpointState(postState, checkpointCache);
  }
  // same logic like in state transition https://github.com/ChainSafe/lodestar/blob/f6778740075fe2b75edf94d1db0b5691039cb500/packages/lodestar/src/chain/blocks/stateTransition.ts#L101
  let justifiedBalances: EffectiveBalanceIncrements | undefined;
  const checkpointHex = toCheckpointHex(postState.currentJustifiedCheckpoint);
  const justifiedState = checkpointCache.get(checkpointHex);
  if (
    postState.currentJustifiedCheckpoint.epoch > forkchoice.getJustifiedCheckpoint().epoch ||
    postState.finalizedCheckpoint.epoch > forkchoice.getFinalizedCheckpoint().epoch
  ) {
    if (!justifiedState) {
      const checkpointHexKey = toCheckpointKey(checkpointHex);
      const cachedCps = checkpointCache.dumpCheckpointKeys().join(", ");
      throw Error(`No justifiedState for checkpoint ${checkpointHexKey}. Available: ${cachedCps}`);
    }
    justifiedBalances = getEffectiveBalanceIncrementsZeroInactive(justifiedState);
  }

  try {
    forkchoice.onBlock(signedBlock.message, postState, {
      blockDelaySec,
      justifiedBalances,
    });
    for (const attestation of signedBlock.message.body.attestations) {
      try {
        const indexedAttestation = postState.epochCtx.getIndexedAttestation(attestation);
        forkchoice.onAttestation(indexedAttestation);
      } catch (e) {
        if (e instanceof ForkChoiceError && e.type.code === ForkChoiceErrorCode.INVALID_ATTESTATION) {
          logger.debug("INVALID_ATTESTATION onAttestation", e.type.err);
        } else {
          logger.error("Error onAttestation", {}, e as Error);
        }
      }
    }
  } catch (e) {
    if (e instanceof ForkChoiceError && e.type.code === ForkChoiceErrorCode.INVALID_BLOCK) {
      logger.debug("INVALID_BLOCK onBlock", e.type.err);
    } else {
      logger.error("Error onBlock", {}, e as Error);
    }
  }
  return postState;
}

function cacheCheckpointState(checkpointState: CachedBeaconStateAllForks, checkpointCache: CheckpointStateCache): void {
  const slot = checkpointState.slot;
  if (slot % SLOTS_PER_EPOCH !== 0) {
    throw new Error(`Invalid checkpoint state slot ${checkpointState.slot}`);
  }
  const blockHeader = ssz.phase0.BeaconBlockHeader.clone(checkpointState.latestBlockHeader);
  if (ssz.Root.equals(blockHeader.stateRoot, ZERO_HASH)) {
    blockHeader.stateRoot = checkpointState.hashTreeRoot();
  }
  const cp: phase0.Checkpoint = {
    root: ssz.phase0.BeaconBlockHeader.hashTreeRoot(blockHeader),
    epoch: computeEpochAtSlot(slot),
  };
  checkpointCache.add(cp, checkpointState);
}

function cacheState(wrappedState: CachedBeaconStateAllForks, stateCache: Map<string, CachedBeaconStateAllForks>): void {
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

type Step = OnTick | OnAttestation | OnBlock | OnPowBlock | Checks;

type SpecTestCheckpoint = {epoch: BigInt; root: string};

// This test executes steps in sequence. There may be multiple items of the following types:
// on_tick execution step

type OnTick = {
  /** to execute `on_tick(store, time)` */
  tick: bigint;
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
  /** optional, default to `true`. */
  valid?: number;
};

type OnPowBlock = {
  /**
   * the name of the `pow_block_<32-byte-root>.ssz_snappy` file. To
   * execute `on_pow_block(store, block)`
   */
  pow_block: string;
};

type Checks = {
  /** Value in the ForkChoice store to verify it's correct after being mutated by another step */
  checks: {
    head?: {
      slot: bigint;
      root: string;
    };
    time?: bigint;
    justified_checkpoint?: SpecTestCheckpoint;
    finalized_checkpoint?: SpecTestCheckpoint;
    best_justified_checkpoint?: SpecTestCheckpoint;
    proposer_boost_root?: RootHex;
  };
};

type ForkChoiceTestCase = {
  meta?: {
    description?: string;
    bls_setting: BigInt;
  };
  anchorState: BeaconStateAllForks;
  anchorBlock: allForks.BeaconBlock;
  steps: Step[];
  blocks: Map<string, allForks.SignedBeaconBlock>;
  powBlocks: Map<string, bellatrix.PowBlock>;
  attestations: Map<string, phase0.Attestation>;
};

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

function serializePowBlock(powBlock: bellatrix.PowBlock | undefined): PowBlockHex | undefined {
  if (powBlock) {
    return {
      blockHash: toHexString(powBlock.blockHash),
      parentHash: toHexString(powBlock.parentHash),
      totalDifficulty: BigInt(powBlock.totalDifficulty),
    };
  }
  return;
}
