import path from "node:path";
import {expect} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {BeaconStateAllForks, isExecutionStateType, signedBlockToSignedHeader} from "@lodestar/state-transition";
import {InputType} from "@lodestar/spec-test-util";
import {CheckpointWithHex, ForkChoice} from "@lodestar/fork-choice";
import {
  bellatrix,
  ssz,
  RootHex,
  deneb,
  BeaconBlock,
  SignedBeaconBlock,
  sszTypesFor,
  Attestation,
  AttesterSlashing,
} from "@lodestar/types";
import {bnToNum, fromHex} from "@lodestar/utils";
import {createBeaconConfig} from "@lodestar/config";
import {ACTIVE_PRESET, ForkSeq, isForkBlobs, ForkName} from "@lodestar/params";
import {BeaconChain, ChainEvent} from "../../../src/chain/index.js";
import {ClockEvent} from "../../../src/util/clock.js";
import {computeInclusionProof} from "../../../src/util/blobs.js";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {testLogger} from "../../utils/logger.js";
import {getConfig} from "../../utils/config.js";
import {RunnerType, TestRunnerFn} from "../utils/types.js";
import {Eth1ForBlockProductionDisabled} from "../../../src/eth1/index.js";
import {getExecutionEngineFromBackend} from "../../../src/execution/index.js";
import {ExecutionPayloadStatus} from "../../../src/execution/engine/interface.js";
import {ExecutionEngineMockBackend} from "../../../src/execution/engine/mock.js";
import {defaultChainOptions} from "../../../src/chain/options.js";
import {getMockedBeaconDb} from "../../mocks/mockedBeaconDb.js";
import {ClockStopped} from "../../mocks/clock.js";
import {
  getBlockInput,
  AttestationImportOpt,
  BlockSource,
  BlobSidecarValidation,
  BlobsSource,
} from "../../../src/chain/blocks/types.js";
import {ZERO_HASH_HEX} from "../../../src/constants/constants.js";
import {PowMergeBlock} from "../../../src/eth1/interface.js";
import {assertCorrectProgressiveBalances} from "../config.js";
import {initCKZG, loadEthereumTrustedSetup} from "../../../src/util/kzg.js";
import {ethereumConsensusSpecsTests} from "../specTestVersioning.js";
import {specTestIterator} from "../utils/specTestIterator.js";

const ANCHOR_STATE_FILE_NAME = "anchor_state";
const ANCHOR_BLOCK_FILE_NAME = "anchor_block";
const BLOCK_FILE_NAME = "^(block)_([0-9a-zA-Z]+)$";
const BLOBS_FILE_NAME = "^(blobs)_([0-9a-zA-Z]+)$";
const POW_BLOCK_FILE_NAME = "^(pow_block)_([0-9a-zA-Z]+)$";
const ATTESTATION_FILE_NAME = "^(attestation)_([0-9a-zA-Z])+$";
const ATTESTER_SLASHING_FILE_NAME = "^(attester_slashing)_([0-9a-zA-Z])+$";

const logger = testLogger("spec-test");

const forkChoiceTest =
  (opts: {onlyPredefinedResponses: boolean}): TestRunnerFn<ForkChoiceTestCase, void> =>
  (fork) => {
    return {
      testFunction: async (testcase) => {
        if (isForkBlobs(fork)) {
          await initCKZG();
          loadEthereumTrustedSetup();
        }

        const {steps, anchorState} = testcase;
        const currentSlot = anchorState.slot;
        const config = getConfig(fork);
        const state = createCachedBeaconStateTest(anchorState, config);

        /** This is to track test's tickTime to be used in proposer boost */
        let tickTime = 0;
        const clock = new ClockStopped(currentSlot);
        const eth1 = new Eth1ForBlockProductionMock();
        const executionEngineBackend = new ExecutionEngineMockBackend({
          onlyPredefinedResponses: opts.onlyPredefinedResponses,
          genesisBlockHash: isExecutionStateType(anchorState)
            ? toHexString(anchorState.latestExecutionPayloadHeader.blockHash)
            : ZERO_HASH_HEX,
        });

        const controller = new AbortController();
        const executionEngine = getExecutionEngineFromBackend(executionEngineBackend, {
          signal: controller.signal,
          logger: testLogger("executionEngine"),
        });

        const chain = new BeaconChain(
          {
            ...defaultChainOptions,
            // Do not start workers
            blsVerifyAllMainThread: true,
            // Do not run any archiver tasks
            disableArchiveOnCheckpoint: true,
            // Since the tests have deep-reorgs attested data is not available often printing lots of error logs.
            // While this function is only called for head blocks, best to disable.
            disableLightClientServerOnImportBlockHead: true,
            // No need to log BlockErrors, the spec test runner will only log them if not not expected
            // Otherwise spec tests logs get cluttered with expected errors
            disableOnBlockError: true,
            // PrepareNextSlot scheduler is used to precompute epoch transition and prepare for the next payload
            // we don't use these in fork choice spec tests
            disablePrepareNextSlot: true,
            assertCorrectProgressiveBalances,
            proposerBoost: true,
            proposerBoostReorg: true,
          },
          {
            config: createBeaconConfig(config, state.genesisValidatorsRoot),
            db: getMockedBeaconDb(),
            logger,
            processShutdownCallback: () => {},
            clock,
            metrics: null,
            anchorState,
            eth1,
            executionEngine,
            executionBuilder: undefined,
          }
        );

        // The handler of `ChainEvent.forkChoiceFinalized` access `db.block` and raise error if not found.
        chain.emitter.removeAllListeners(ChainEvent.forkChoiceFinalized);

        const stepsLen = steps.length;
        logger.debug("Fork choice test", {steps: stepsLen});

        try {
          for (const [i, step] of steps.entries()) {
            if (isTick(step)) {
              tickTime = bnToNum(step.tick);
              const currentSlot = Math.floor(tickTime / config.SECONDS_PER_SLOT);
              logger.debug(`Step ${i}/${stepsLen} tick`, {currentSlot, valid: Boolean(step.valid), time: tickTime});
              clock.emit(ClockEvent.slot, currentSlot);
              clock.setSlot(currentSlot);
            }

            // attestation step
            else if (isAttestation(step)) {
              logger.debug(`Step ${i}/${stepsLen} attestation`, {root: step.attestation, valid: Boolean(step.valid)});
              const attestation = testcase.attestations.get(step.attestation);
              if (!attestation) throw Error(`No attestation ${step.attestation}`);
              const headState = chain.getHeadState();
              const attDataRootHex = toHexString(sszTypesFor(fork).AttestationData.hashTreeRoot(attestation.data));
              chain.forkChoice.onAttestation(
                headState.epochCtx.getIndexedAttestation(ForkSeq[fork], attestation),
                attDataRootHex
              );
            }

            // attester slashing step
            else if (isAttesterSlashing(step)) {
              logger.debug(`Step ${i}/${stepsLen} attester slashing`, {
                root: step.attester_slashing,
                valid: Boolean(step.valid),
              });
              const attesterSlashing = testcase.attesterSlashings.get(step.attester_slashing);
              if (!attesterSlashing) throw Error(`No attester slashing ${step.attester_slashing}`);
              chain.forkChoice.onAttesterSlashing(attesterSlashing);
            }

            // block step
            else if (isBlock(step)) {
              const isValid = Boolean(step.valid ?? true);
              const signedBlock = testcase.blocks.get(step.block);
              if (!signedBlock) {
                throw Error(`No block ${step.block}`);
              }

              let blobs: deneb.Blob[] | undefined;
              let proofs: deneb.KZGProof[] | undefined;
              if (step.blobs !== undefined) {
                blobs = testcase.blobs.get(step.blobs);
              }
              if (step.proofs !== undefined) {
                proofs = step.proofs.map((proof) => ssz.deneb.KZGProof.deserialize(fromHex(proof)));
              }

              const {slot} = signedBlock.message;
              // Log the BeaconBlock root instead of the SignedBeaconBlock root, forkchoice references BeaconBlock roots
              const blockRoot = config
                .getForkTypes(signedBlock.message.slot)
                .BeaconBlock.hashTreeRoot(signedBlock.message);
              logger.debug(`Step ${i}/${stepsLen} block`, {
                slot,
                id: step.block,
                root: toHexString(blockRoot),
                parentRoot: toHexString(signedBlock.message.parentRoot),
                isValid,
              });

              try {
                let blockImport;
                if (config.getForkSeq(slot) >= ForkSeq.deneb) {
                  if (blobs === undefined) {
                    // seems like some deneb tests don't have this and we are supposed to assume empty
                    // throw Error("Missing blobs for the deneb+ block");
                    blobs = [];
                  }
                  if (proofs === undefined) {
                    // seems like some deneb tests don't have this and we are supposed to assume empty
                    // throw Error("proofs for the deneb+ block");
                    proofs = [];
                  }
                  // the kzg lib for validation of minimal setup is not yet integrated, lets just verify lengths
                  // post integration use validateBlobsAndProofs
                  const commitments = (signedBlock as deneb.SignedBeaconBlock).message.body.blobKzgCommitments;
                  if (blobs.length !== commitments.length || proofs.length !== commitments.length) {
                    throw Error("Invalid blobs or proofs lengths");
                  }

                  const blobSidecars: deneb.BlobSidecars = blobs.map((blob, index) => {
                    return {
                      index,
                      blob,
                      kzgCommitment: commitments[index],
                      kzgProof: (proofs ?? [])[index],
                      signedBlockHeader: signedBlockToSignedHeader(config, signedBlock),
                      kzgCommitmentInclusionProof: computeInclusionProof(fork, signedBlock.message.body, index),
                    };
                  });

                  blockImport = getBlockInput.availableData(config, signedBlock, BlockSource.gossip, null, {
                    fork: ForkName.deneb,
                    blobs: blobSidecars,
                    blobsBytes: [null],
                    blobsSource: BlobsSource.gossip,
                  });
                } else {
                  blockImport = getBlockInput.preData(config, signedBlock, BlockSource.gossip, null);
                }

                await chain.processBlock(blockImport, {
                  seenTimestampSec: tickTime,
                  validBlobSidecars: BlobSidecarValidation.Full,
                  importAttestations: AttestationImportOpt.Force,
                });
                if (!isValid) throw Error("Expect error since this is a negative test");
              } catch (e) {
                if (isValid || (e as Error).message === "Expect error since this is a negative test") throw e;
              }
            }

            // **on_merge_block execution**
            // Adds PowBlock data which is required for executing on_block(store, block).
            // The file is located in the same folder (see below). PowBlocks should be used as return values for
            // get_pow_block(hash: Hash32) -> PowBlock function if hashes match.
            else if (isPowBlock(step)) {
              const powBlock = testcase.powBlocks.get(step.pow_block);
              if (!powBlock) throw Error(`pow_block ${step.pow_block} not found`);
              logger.debug(`Step ${i}/${stepsLen} pow_block`, {
                blockHash: toHexString(powBlock.blockHash),
                parentHash: toHexString(powBlock.parentHash),
              });
              // Register PowBlock for `get_pow_block(hash: Hash32)` calls in verifyBlock
              eth1.addPowBlock(powBlock);
              // Register PowBlock to allow validation in execution engine
              executionEngineBackend.addPowBlock(powBlock);
            }

            // Optional step for optimistic sync tests.
            else if (isOnPayloadInfoStep(step)) {
              logger.debug(`Step ${i}/${stepsLen} payload_status`, {blockHash: step.block_hash});
              const status = ExecutionPayloadStatus[step.payload_status.status];
              if (status === undefined) {
                throw Error(`Unknown payload_status.status: ${step.payload_status.status}`);
              }
              executionEngineBackend.addPredefinedPayloadStatus(step.block_hash, {
                status,
                latestValidHash: step.payload_status.latest_valid_hash,
                validationError: step.payload_status.validation_error,
              });
            }

            // checks step
            else if (isCheck(step)) {
              logger.debug(`Step ${i}/${stepsLen} check`);

              // Forkchoice head is computed lazily only on request
              const head = (chain.forkChoice as ForkChoice).updateHead();
              const proposerBootRoot = (chain.forkChoice as ForkChoice).getProposerBoostRoot();

              if (step.checks.head !== undefined) {
                expect({slot: head.slot, root: head.blockRoot}).toEqualWithMessage(
                  {slot: bnToNum(step.checks.head.slot), root: step.checks.head.root},
                  `Invalid head at step ${i}`
                );
              }
              if (step.checks.proposer_boost_root !== undefined) {
                expect(proposerBootRoot).toEqualWithMessage(
                  step.checks.proposer_boost_root,
                  `Invalid proposer boost root at step ${i}`
                );
              }
              // time in spec mapped to Slot in our forkchoice implementation.
              // Compare in slots because proposer boost steps doesn't always come on
              // slot boundary.
              if (step.checks.time !== undefined && step.checks.time > 0)
                expect(chain.forkChoice.getTime()).toEqualWithMessage(
                  Math.floor(bnToNum(step.checks.time) / config.SECONDS_PER_SLOT),
                  `Invalid forkchoice time at step ${i}`
                );
              if (step.checks.justified_checkpoint) {
                expect(toSpecTestCheckpoint(chain.forkChoice.getJustifiedCheckpoint())).toEqualWithMessage(
                  step.checks.justified_checkpoint,
                  `Invalid justified checkpoint at step ${i}`
                );
              }
              if (step.checks.finalized_checkpoint) {
                expect(toSpecTestCheckpoint(chain.forkChoice.getFinalizedCheckpoint())).toEqualWithMessage(
                  step.checks.finalized_checkpoint,
                  `Invalid finalized checkpoint at step ${i}`
                );
              }
              if (step.checks.get_proposer_head) {
                const currentSlot = Math.floor(tickTime / config.SECONDS_PER_SLOT);
                const {proposerHead, notReorgedReason} = (chain.forkChoice as ForkChoice).getProposerHead(
                  head,
                  tickTime % config.SECONDS_PER_SLOT,
                  currentSlot
                );
                logger.debug(`Not reorged reason ${notReorgedReason} at step ${i}`);
                expect(proposerHead.blockRoot).toEqualWithMessage(
                  step.checks.get_proposer_head,
                  `Invalid proposer head at step ${i}`
                );
              }
            }

            // None of the above
            else {
              throw Error(`Unknown step ${i}/${stepsLen}: ${JSON.stringify(Object.keys(step))}`);
            }
          }
        } finally {
          await chain.close();
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
          [BLOBS_FILE_NAME]: ssz.deneb.Blobs,
          [POW_BLOCK_FILE_NAME]: ssz.bellatrix.PowBlock,
          [ATTESTATION_FILE_NAME]: sszTypesFor(fork).Attestation,
          [ATTESTER_SLASHING_FILE_NAME]: sszTypesFor(fork).AttesterSlashing,
        },
        mapToTestCase: (t: Record<string, any>) => {
          // t has input file name as key
          const blocks = new Map<string, SignedBeaconBlock>();
          const blobs = new Map<string, deneb.Blobs>();
          const powBlocks = new Map<string, bellatrix.PowBlock>();
          const attestations = new Map<string, Attestation>();
          const attesterSlashings = new Map<string, AttesterSlashing>();
          for (const key in t) {
            const blockMatch = key.match(BLOCK_FILE_NAME);
            if (blockMatch) {
              blocks.set(key, t[key]);
            }
            const blobsMatch = key.match(BLOBS_FILE_NAME);
            if (blobsMatch) {
              blobs.set(key, t[key]);
            }
            const powBlockMatch = key.match(POW_BLOCK_FILE_NAME);
            if (powBlockMatch) {
              powBlocks.set(key, t[key]);
            }
            const attMatch = key.match(ATTESTATION_FILE_NAME);
            if (attMatch) {
              attestations.set(key, t[key]);
            }
            const attesterSlashingMatch = key.match(ATTESTER_SLASHING_FILE_NAME);
            if (attesterSlashingMatch) {
              attesterSlashings.set(key, t[key]);
            }
          }
          return {
            meta: t["meta"] as ForkChoiceTestCase["meta"],
            anchorState: t[ANCHOR_STATE_FILE_NAME] as ForkChoiceTestCase["anchorState"],
            anchorBlock: t[ANCHOR_BLOCK_FILE_NAME] as ForkChoiceTestCase["anchorBlock"],
            steps: t["steps"] as ForkChoiceTestCase["steps"],
            blocks,
            blobs,
            powBlocks,
            attestations,
            attesterSlashings,
          };
        },
        timeout: 10000,
        expectFunc: () => {},
        // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
        // EXCEPTION : this test skipped here because prefix match can't be don't for this particular test
        // as testId for the entire directory is same : `deneb/fork_choice/on_block/pyspec_tests` and
        // we just want to skip this one particular test because we don't have minimal kzg lib integrated
        //
        // This skip can be removed once c-kzg lib with run-time minimal blob size setup is released and
        // integrated
        shouldSkip: (_testcase, name, _index) => name.includes("invalid_incorrect_proof"),
      },
    };
  };

function toSpecTestCheckpoint(checkpoint: CheckpointWithHex): SpecTestCheckpoint {
  return {
    epoch: BigInt(checkpoint.epoch),
    root: checkpoint.rootHex,
  };
}

type Step = OnTick | OnAttestation | OnAttesterSlashing | OnBlock | OnPowBlock | OnPayloadInfo | Checks;

type SpecTestCheckpoint = {epoch: bigint; root: string};

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

type OnAttesterSlashing = {
  /**
   * the name of the `attester_slashing_<32-byte-root>.ssz_snappy` file.
   * To execute `on_attester_slashing(store, attester_slashing)` with the given attester slashing.
   */
  attester_slashing: string;
  /** optional, default to `true` */
  valid?: number;
};

type OnBlock = {
  /** the name of the `block_<32-byte-root>.ssz_snappy` file. To execute `on_block(store, block)` */
  block: string;
  blobs?: string;
  proofs?: string[];
  /** optional, default to `true`. */
  valid?: number;
};

/** Optional step for optimistic sync tests. */
type OnPowBlock = {
  /**
   * the name of the `pow_block_<32-byte-root>.ssz_snappy` file. To
   * execute `on_pow_block(store, block)`
   */
  pow_block: string;
};

type OnPayloadInfo = {
  /** Encoded 32-byte value of payload's block hash. */
  block_hash: string;
  payload_status: {
    status: "VALID" | "INVALID" | "SYNCING" | "ACCEPTED" | "INVALID_BLOCK_HASH";
    /** Encoded 32-byte value of the latest valid block hash, may be `null`. */
    latest_valid_hash: string;
    /** Message providing additional details on the validation error, may be `null`. */
    validation_error: string;
  };
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
    proposer_boost_root?: RootHex;
    get_proposer_head?: string;
  };
};

type ForkChoiceTestCase = {
  meta?: {
    description?: string;
    bls_setting: bigint;
  };
  anchorState: BeaconStateAllForks;
  anchorBlock: BeaconBlock;
  steps: Step[];
  blocks: Map<string, SignedBeaconBlock>;
  blobs: Map<string, deneb.Blobs>;
  powBlocks: Map<string, bellatrix.PowBlock>;
  attestations: Map<string, Attestation>;
  attesterSlashings: Map<string, AttesterSlashing>;
};

function isTick(step: Step): step is OnTick {
  return (step as OnTick).tick >= 0;
}

function isAttestation(step: Step): step is OnAttestation {
  return typeof (step as OnAttestation).attestation === "string";
}

function isAttesterSlashing(step: Step): step is OnAttesterSlashing {
  return typeof (step as OnAttesterSlashing).attester_slashing === "string";
}

function isBlock(step: Step): step is OnBlock {
  return typeof (step as OnBlock).block === "string";
}

function isPowBlock(step: Step): step is OnPowBlock {
  return typeof (step as OnPowBlock).pow_block === "string";
}

function isOnPayloadInfoStep(step: Step): step is OnPayloadInfo {
  return typeof (step as OnPayloadInfo).block_hash === "string";
}

function isCheck(step: Step): step is Checks {
  return typeof (step as Checks).checks === "object";
}

// Extend Eth1ForBlockProductionDisabled to not have to re-implement new methods
class Eth1ForBlockProductionMock extends Eth1ForBlockProductionDisabled {
  private items = new Map<string, PowMergeBlock>();

  async getPowBlock(powBlockHash: string): Promise<PowMergeBlock | null> {
    return this.items.get(powBlockHash) ?? null;
  }

  addPowBlock(powBlock: bellatrix.PowBlock): void {
    this.items.set(toHexString(powBlock.blockHash), {
      // not used by verifyBlock()
      number: 0,
      blockHash: toHexString(powBlock.blockHash),
      parentHash: toHexString(powBlock.parentHash),
      totalDifficulty: powBlock.totalDifficulty,
    });
  }
}

specTestIterator(path.join(ethereumConsensusSpecsTests.outputDir, "tests", ACTIVE_PRESET), {
  fork_choice: {type: RunnerType.default, fn: forkChoiceTest({onlyPredefinedResponses: false})},
  sync: {type: RunnerType.default, fn: forkChoiceTest({onlyPredefinedResponses: true})},
});
