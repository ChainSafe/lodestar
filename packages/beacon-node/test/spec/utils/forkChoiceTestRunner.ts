import {generateKeyPair} from "@libp2p/crypto/keys";
import {expect} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {toHexString} from "@chainsafe/ssz";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {CheckpointWithHex, ExecutionStatus, ForkChoice} from "@lodestar/fork-choice";
import {testLogger} from "@lodestar/logger/test-utils";
import {
  ForkPostDeneb,
  ForkPostFulu,
  ForkPostGloas,
  ForkPreDeneb,
  ForkPreFulu,
  ForkPreGloas,
  ForkSeq,
} from "@lodestar/params";
import {InputType} from "@lodestar/spec-test-util";
import {
  BeaconStateAllForks,
  BeaconStateView,
  DataAvailabilityStatus,
  IBeaconStateViewGloas,
  computeEpochAtSlot,
  createCachedBeaconState,
  createIndexedSignatureSetFromComponents,
  getIndexedAttestation,
  getPayloadAttestationDataSigningRoot,
  isExecutionStateType,
  isGloasStateType,
  signedBlockToSignedHeader,
} from "@lodestar/state-transition";
import {
  Attestation,
  AttesterSlashing,
  BeaconBlock,
  RootHex,
  SignedBeaconBlock,
  deneb,
  fulu,
  gloas,
  ssz,
  sszTypesFor,
} from "@lodestar/types";
import {PayloadAttestationMessage} from "@lodestar/types/gloas";
import {bnToNum, fromHex, toHex, toRootHex} from "@lodestar/utils";
import {
  BlockInputBlobs,
  BlockInputColumns,
  BlockInputNoData,
  BlockInputPreData,
  BlockInputSource,
} from "../../../src/chain/blocks/blockInput/index.js";
import {PayloadEnvelopeInputSource} from "../../../src/chain/blocks/payloadEnvelopeInput/index.js";
import {AttestationImportOpt, BlobSidecarValidation} from "../../../src/chain/blocks/types.js";
import {
  verifyExecutionPayloadEnvelope,
  verifyExecutionPayloadEnvelopeSignature,
} from "../../../src/chain/blocks/verifyExecutionPayloadEnvelope.js";
import {BlockError, BlockErrorCode} from "../../../src/chain/errors/blockError.js";
import {BeaconChain, ChainEvent} from "../../../src/chain/index.js";
import {defaultChainOptions} from "../../../src/chain/options.js";
import {RegenCaller} from "../../../src/chain/regen/index.js";
import {getShufflingForAttestationVerification} from "../../../src/chain/validation/attestation.js";
import {validateFuluBlockDataColumnSidecars} from "../../../src/chain/validation/dataColumnSidecar.js";
import {ZERO_HASH_HEX} from "../../../src/constants/constants.js";
import {ExecutionPayloadStatus} from "../../../src/execution/engine/interface.js";
import {ExecutionEngineMockBackend} from "../../../src/execution/engine/mock.js";
import {getExecutionEngineFromBackend} from "../../../src/execution/index.js";
import {computePreFuluKzgCommitmentsInclusionProof} from "../../../src/util/blobs.js";
import {ClockEvent} from "../../../src/util/clock.js";
import {ClockStopped} from "../../mocks/clock.js";
import {getMockedBeaconDb} from "../../mocks/mockedBeaconDb.js";
import {assertCorrectProgressiveBalances} from "../config.js";
import {TestRunnerFn} from "./types.js";

const ANCHOR_STATE_FILE_NAME = "anchor_state";
const ANCHOR_BLOCK_FILE_NAME = "anchor_block";
const BLOCK_FILE_NAME = "^(block)_([0-9a-zA-Z]+)$";
const BLOBS_FILE_NAME = "^(blobs)_([0-9a-zA-Z]+)$";
const COLUMN_FILE_NAME = "^(column)_([0-9a-zA-Z]+)$";
const EXECUTION_PAYLOAD_ENVELOPE_FILE_NAME = "^(execution_payload_envelope)_([0-9a-zA-Z]+)$";
const ATTESTATION_FILE_NAME = "^(attestation)_([0-9a-zA-Z])+$";
const ATTESTER_SLASHING_FILE_NAME = "^(attester_slashing)_([0-9a-zA-Z])+$";
const PAYLOAD_ATTESTATION_MESSAGE_FILE_NAME = "^(payload_attestation_message)_([0-9a-zA-Z])+$";

const logger = testLogger("spec-test");

export const forkChoiceTestRunner =
  (opts: {onlyPredefinedResponses: boolean}): TestRunnerFn<ForkChoiceTestCase, void> =>
  (fork) => {
    return {
      testFunction: async (testcase, _directoryName, testCaseName) => {
        const {steps, anchorState} = testcase;
        const currentSlot = anchorState.slot;
        const config = getConfig(fork);
        // const state = createCachedBeaconStateTest(anchorState, config);

        /** This is to track test's tickTime to be used in proposer boost */
        let tickTime = 0;
        const clock = new ClockStopped(currentSlot);
        const executionEngineBackend = new ExecutionEngineMockBackend({
          onlyPredefinedResponses: opts.onlyPredefinedResponses,
          genesisBlockHash: isGloasStateType(anchorState)
            ? toHexString(anchorState.latestBlockHash)
            : isExecutionStateType(anchorState)
              ? toHexString(anchorState.latestExecutionPayloadHeader.blockHash)
              : ZERO_HASH_HEX,
        });

        const controller = new AbortController();
        const executionEngine = getExecutionEngineFromBackend(executionEngineBackend, {
          signal: controller.signal,
          logger: testLogger("executionEngine"),
        });

        const beaconConfig = createBeaconConfig(config, anchorState.genesisValidatorsRoot);
        pubkeyCache.syncPubkeys(anchorState.validators.getAllReadonlyValues());
        const cachedState = createCachedBeaconState(
          anchorState,
          {
            config: beaconConfig,
            pubkeyCache,
          },
          {skipSyncPubkeys: true}
        );

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
            privateKey: await generateKeyPair("secp256k1"),
            config: beaconConfig,
            pubkeyCache,
            db: getMockedBeaconDb(),
            dataDir: ".",
            dbName: ",",
            logger,
            processShutdownCallback: () => {},
            clock,
            metrics: null,
            validatorMonitor: null,
            anchorState: new BeaconStateView(cachedState),
            isAnchorStateFinalized: true,
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
              const currentSlot = Math.floor(tickTime / (config.SLOT_DURATION_MS / 1000));
              logger.debug(`Step ${i}/${stepsLen} tick`, {currentSlot, valid: Boolean(step.valid), time: tickTime});
              clock.emit(ClockEvent.slot, currentSlot);
              clock.setSlot(currentSlot);
            }

            // attestation step
            else if (isAttestation(step)) {
              const isValid = Boolean(step.valid ?? true);
              logger.debug(`Step ${i}/${stepsLen} attestation`, {root: step.attestation, valid: isValid});
              const attestation = testcase.attestations.get(step.attestation);
              if (!attestation) throw Error(`No attestation ${step.attestation}`);
              const attDataRootHex = toHexString(sszTypesFor(fork).AttestationData.hashTreeRoot(attestation.data));

              // Spec `validate_on_attestation` requires `get_current_slot(store) >= attestation.data.slot + 1`
              // (an attestation may only influence fork choice from the slot AFTER it was created). Lodestar
              // enforces this 1-slot delay in the gossip/attestation-pool layer, not in `forkChoice.onAttestation`,
              // so replicate the precondition here since the runner calls `onAttestation` directly.
              // `clock.currentSlot` is initialized from the anchor state slot and advanced by tick
              // steps — matching `get_current_slot(store)` even before the first tick.
              if (clock.currentSlot < attestation.data.slot + 1) {
                if (isValid) {
                  throw Error(`Attestation not yet 1 slot old but marked valid at step ${i}`);
                }
                logger.debug(
                  `Step ${i}/${stepsLen} skip attestation: not yet 1 slot old (spec on_attestation rejects)`,
                  {
                    attSlot: attestation.data.slot,
                    currentSlot: clock.currentSlot,
                  }
                );
                continue;
              }

              // `on_attestation` decodes aggregation_bits with the shuffling at the attestation's
              // target checkpoint, not the head state — resolve it via ShufflingCache + regen so
              // cross-epoch fork attestations (surfaced by the compliance suite) decode correctly.
              // The resolution runs inside the try so that errors on `valid: false` steps (e.g.
              // attesting to a future block) count as the expected rejection.
              const attHeadBlock = chain.forkChoice.getBlockHexDefaultStatus(toHex(attestation.data.beaconBlockRoot));
              if (attHeadBlock === null && isValid) {
                throw Error(`Attestation beacon block root unknown to fork choice at step ${i}`);
              }
              try {
                if (attHeadBlock === null) throw Error("Unknown attestation head block (expected rejection)");
                const shuffling = await getShufflingForAttestationVerification(
                  chain,
                  computeEpochAtSlot(attestation.data.slot),
                  attHeadBlock,
                  RegenCaller.validateGossipAttestation
                );
                const indexedAttestation = getIndexedAttestation(shuffling, ForkSeq[fork], attestation);
                chain.forkChoice.onAttestation(indexedAttestation, attDataRootHex);
                if (!isValid) throw Error("Expect error since this is a negative test");
              } catch (e) {
                if (isValid || (e as Error).message === "Expect error since this is a negative test") throw e;
              }
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

            // payload attestation message step
            else if (isPayloadAttestationMessage(step)) {
              const isValid = Boolean(step.valid ?? true);
              logger.debug(`Step ${i}/${stepsLen} payload attestation message`, {
                root: step.payload_attestation_message,
                valid: isValid,
              });
              const payloadAttestationMessage = testcase.payloadAttestationMessages.get(
                step.payload_attestation_message
              );
              if (!payloadAttestationMessage)
                throw Error(`No payload attestation message ${step.payload_attestation_message}`);
              try {
                const blockRoot = toRootHex(payloadAttestationMessage.data.beaconBlockRoot);
                const protoBlock = chain.forkChoice.getBlockHexDefaultStatus(blockRoot);
                if (!protoBlock) {
                  throw Error(`Block not found for root ${blockRoot}`);
                }

                // "PTC votes can only change the vote for their assigned beacon block, return
                // early otherwise" — a slot mismatch is a no-op SUCCESS, not a rejection.
                // https://github.com/ethereum/consensus-specs/blob/v1.7.0-alpha.12/specs/gloas/fork-choice.md#on_payload_attestation_message
                if (protoBlock.slot === payloadAttestationMessage.data.slot) {
                  const blockState = await chain.regen.getBlockSlotState(
                    protoBlock,
                    payloadAttestationMessage.data.slot,
                    {dontTransferCache: true},
                    RegenCaller.processBlock
                  );

                  const ptcIndices = (blockState as IBeaconStateViewGloas).getIndicesInPayloadTimelinessCommittee(
                    payloadAttestationMessage.validatorIndex,
                    payloadAttestationMessage.data.slot
                  );

                  // Spec asserts the validator is a PTC member for the slot
                  if (ptcIndices.length === 0) {
                    throw Error(
                      `Validator ${payloadAttestationMessage.validatorIndex} not in PTC for slot ${payloadAttestationMessage.data.slot}`
                    );
                  }

                  // Slot check, matching the `validateGossipPayloadAttestationMessage` flow
                  if (clock.currentSlot !== payloadAttestationMessage.data.slot) {
                    throw Error(
                      `Message slot ${payloadAttestationMessage.data.slot} is not current slot ${clock.currentSlot}`
                    );
                  }

                  // Signature verification (matching `validateGossipPayloadAttestationMessage`) — skipped for
                  // bls_setting !== 1: compliance fixtures use placeholder signatures (bls_setting: 2), so the
                  // spec reference runner does not verify. Mirror the block-import accommodation (`validSignatures`).
                  if (testcase.meta?.bls_setting === BigInt(1)) {
                    const signatureSet = createIndexedSignatureSetFromComponents(
                      payloadAttestationMessage.validatorIndex,
                      getPayloadAttestationDataSigningRoot(beaconConfig, payloadAttestationMessage.data),
                      payloadAttestationMessage.signature
                    );
                    let signatureValidity: boolean;
                    try {
                      signatureValidity = await chain.bls.verifySignatureSets([signatureSet], {
                        verifyOnMainThread: true,
                        batchable: true,
                        priority: true,
                      });
                    } catch {
                      signatureValidity = false;
                    }
                    if (!signatureValidity) throw Error("Invalid payload attestation signature");
                  }

                  chain.forkChoice.notifyPtcMessages(
                    blockRoot,
                    payloadAttestationMessage.data.slot,
                    ptcIndices,
                    payloadAttestationMessage.data.payloadPresent,
                    payloadAttestationMessage.data.blobDataAvailable
                  );
                }
                if (!isValid) throw Error("Expect error since this is a negative test");
              } catch (e) {
                if (isValid || (e as Error).message === "Expect error since this is a negative test") throw e;
              }
            }

            // block step
            else if (isBlock(step)) {
              const isValid = Boolean(step.valid ?? true);
              const signedBlock = testcase.blocks.get(step.block);
              if (!signedBlock) {
                throw Error(`No block ${step.block}`);
              }

              // Post-Deneb and pre-Fulu, `columns` should not be present. Post-Fulu `blobs` and
              // `proofs` should not be present.
              let blobs: deneb.Blob[] | undefined;
              let proofs: deneb.KZGProof[] | undefined;
              let columns: fulu.DataColumnSidecar[] | undefined;
              if (step.blobs !== undefined) {
                blobs = testcase.blobs.get(step.blobs);
              }
              if (step.proofs !== undefined) {
                proofs = step.proofs.map((proof) => ssz.deneb.KZGProof.deserialize(fromHex(proof)));
              }
              if (step.columns !== undefined) {
                columns = [];
                for (const columnName of step.columns) {
                  const column = testcase.columns.get(columnName);
                  if (column === undefined) {
                    throw Error(`Malformed spec test. Column file with name ${columnName} not found.`);
                  }
                  columns.push(column);
                }
              }

              const {slot} = signedBlock.message;
              // Log the BeaconBlock root instead of the SignedBeaconBlock root, forkchoice references BeaconBlock roots
              const blockRoot = config
                .getForkTypes(signedBlock.message.slot)
                .BeaconBlock.hashTreeRoot(signedBlock.message);
              const blockRootHex = toHex(blockRoot);
              logger.debug(`Step ${i}/${stepsLen} block`, {
                slot,
                id: step.block,
                root: toHexString(blockRoot),
                parentRoot: toHexString(signedBlock.message.parentRoot),
                isValid,
              });

              try {
                let blockImport;
                const forkSeq = config.getForkSeq(slot);

                if (forkSeq >= ForkSeq.gloas) {
                  // Gloas (ePBS) blocks don't carry blobs/columns directly on the block body.
                  // Blob KZG commitments are nested inside signedExecutionPayloadBid.
                  // Use BlockInputNoData since DA is handled separately via execution payload envelopes.
                  blockImport = BlockInputNoData.createFromBlock({
                    forkName: fork,
                    block: signedBlock as SignedBeaconBlock<ForkPostGloas>,
                    blockRootHex,
                    source: BlockInputSource.gossip,
                    seenTimestampSec: 0,
                    daOutOfRange: false,
                  });
                  // importBlock requires a PayloadEnvelopeInput to exist for gloas blocks; in
                  // production this is seeded by gossip / by-root / by-range / API producers.
                  // Spec tests bypass those, so seed it here to mirror the gossip-handler path.
                  chain.seenPayloadEnvelopeInputCache.add({
                    blockRootHex,
                    block: signedBlock as SignedBeaconBlock<ForkPostGloas>,
                    forkName: fork,
                    sampledColumns: chain.custodyConfig.sampledColumns,
                    custodyColumns: chain.custodyConfig.custodyColumns,
                    seenTimestampSec: Date.now() / 1000,
                    source: PayloadEnvelopeInputSource.gossip,
                  });
                } else if (forkSeq >= ForkSeq.fulu) {
                  if (columns === undefined) {
                    columns = [];
                  }

                  await validateFuluBlockDataColumnSidecars(
                    chain,
                    slot,
                    blockRoot,
                    (signedBlock as SignedBeaconBlock<ForkPostFulu & ForkPreGloas>).message.body.blobKzgCommitments
                      .length,
                    columns,
                    chain.metrics?.peerDas
                  );

                  blockImport = BlockInputColumns.createFromBlock({
                    forkName: fork,
                    block: signedBlock as SignedBeaconBlock<ForkPostFulu & ForkPreGloas>,
                    blockRootHex,
                    custodyColumns:
                      // in most test case instances we do not want to assign any custody as there are no columns provided
                      // with the test case.  For on_block_peerdas__not_available the exact situation that is being tested
                      // is no availability so block processing should fail.  For this one test case add some default
                      // custody so that the await will fail in verifyBlocksDataAvailability.ts
                      testCaseName !== "on_block_peerdas__not_available" ? columns.map((c) => c.index) : [2, 4, 6, 8],
                    sampledColumns:
                      testCaseName !== "on_block_peerdas__not_available"
                        ? columns.map((c) => c.index)
                        : [2, 4, 6, 8, 10, 12, 14, 16],
                    source: BlockInputSource.gossip,
                    seenTimestampSec: 0,
                    daOutOfRange: false,
                  });
                  for (const column of columns) {
                    blockImport.addColumn({
                      blockRootHex,
                      columnSidecar: column,
                      source: BlockInputSource.gossip,
                      seenTimestampSec: 0,
                    });
                  }
                  // getBlockInput.availableData(config, signedBlock, BlockSource.gossip, blockData);
                } else if (forkSeq >= ForkSeq.deneb && forkSeq < ForkSeq.fulu) {
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
                      kzgCommitmentInclusionProof: computePreFuluKzgCommitmentsInclusionProof(
                        fork,
                        signedBlock.message.body,
                        index
                      ),
                    };
                  });

                  blockImport = BlockInputBlobs.createFromBlock({
                    forkName: fork,
                    block: signedBlock as SignedBeaconBlock<ForkPostDeneb & ForkPreFulu>,
                    blockRootHex,
                    source: BlockInputSource.gossip,
                    seenTimestampSec: 0,
                    daOutOfRange: false,
                  });
                  for (const blob of blobSidecars) {
                    blockImport.addBlob({
                      blockRootHex,
                      blobSidecar: blob,
                      source: BlockInputSource.gossip,
                      seenTimestampSec: 0,
                    });
                  }
                } else {
                  blockImport = BlockInputPreData.createFromBlock({
                    forkName: fork,
                    block: signedBlock as SignedBeaconBlock<ForkPreDeneb>,
                    blockRootHex,
                    source: BlockInputSource.gossip,
                    seenTimestampSec: 0,
                    daOutOfRange: false,
                  });
                }

                await chain.processBlock(blockImport, {
                  seenTimestampSec: tickTime,
                  validBlobSidecars: BlobSidecarValidation.Full,
                  importAttestations: AttestationImportOpt.Force,
                  validSignatures: testcase.meta?.bls_setting !== BigInt(1),
                });
                if (!isValid) throw Error("Expect error since this is a negative test");
              } catch (e) {
                // Runner accommodation with a known limitation: the spec re-processes a duplicate
                // block (re-runs the state transition and may refresh timeliness/boost/checkpoint
                // state), while lodestar's production import path rejects duplicates with
                // ALREADY_KNOWN. Treat as success; a vector that relies on duplicate-block side
                // effects would diverge here.
                if (isValid && e instanceof BlockError && e.type.code === BlockErrorCode.ALREADY_KNOWN) {
                  logger.debug(`Step ${i}/${stepsLen} block already known — treating as no-op success`, {
                    id: step.block,
                  });
                } else if (isValid || (e as Error).message === "Expect error since this is a negative test") {
                  throw e;
                }
              }
            }

            // execution_payload step for Gloas (ePBS) tests
            else if (isExecutionPayload(step)) {
              const isValid = Boolean(step.valid ?? true);
              logger.debug(`Step ${i}/${stepsLen} execution_payload`, {
                envelope: step.execution_payload,
                valid: isValid,
              });
              const envelope = testcase.executionPayloadEnvelopes.get(step.execution_payload);
              if (!envelope) throw Error(`No execution payload envelope ${step.execution_payload}`);

              try {
                const beaconBlockRoot = toHex(envelope.message.beaconBlockRoot);
                const blockHash = toHex(envelope.message.payload.blockHash);
                const blockNumber = envelope.message.payload.blockNumber;
                const gasLimit = envelope.message.payload.gasLimit;

                // Verify envelope against the state
                const protoBlock = chain.forkChoice.getBlockHexDefaultStatus(beaconBlockRoot);
                if (!protoBlock) throw Error(`Block not found for root ${beaconBlockRoot}`);
                const blockState = await chain.regen.getBlockSlotState(
                  protoBlock,
                  protoBlock.slot,
                  {dontTransferCache: true},
                  RegenCaller.processBlock
                );
                verifyExecutionPayloadEnvelope(beaconConfig, blockState as IBeaconStateViewGloas, envelope.message);

                // Verify signature — skipped for bls_setting !== 1: compliance fixtures use placeholder
                // signatures (bls_setting: 2), so the spec reference runner does not verify. Mirror the
                // block-import accommodation (`validSignatures` above).
                if (testcase.meta?.bls_setting === BigInt(1)) {
                  const sigValid = await verifyExecutionPayloadEnvelopeSignature(
                    beaconConfig,
                    blockState as IBeaconStateViewGloas,
                    envelope,
                    blockState.latestBlockHeader.proposerIndex,
                    chain.bls
                  );
                  if (!sigValid) throw Error("Invalid execution payload envelope signature");
                }

                // Add predefined VALID status for the payload's block hash so the EL mock accepts it
                executionEngineBackend.addPredefinedPayloadStatus(blockHash, {
                  status: ExecutionPayloadStatus.VALID,
                  latestValidHash: null,
                  validationError: null,
                });

                (chain.forkChoice as ForkChoice).onExecutionPayload(
                  beaconBlockRoot,
                  blockHash,
                  blockNumber,
                  gasLimit,
                  ExecutionStatus.Valid,
                  DataAvailabilityStatus.Available
                );
                if (!isValid) throw Error("Expect error since this is a negative test");
              } catch (e) {
                if (isValid || (e as Error).message === "Expect error since this is a negative test") throw e;
              }
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
              // Spec: EMPTY=0, FULL=1, PENDING=2; Ours: PENDING=0, EMPTY=1, FULL=2
              const payloadStatusToSpec: Record<number, number> = {0: 2, 1: 0, 2: 1};

              if (step.checks.head !== undefined) {
                expect({slot: head.slot, root: head.blockRoot}).toEqualWithMessage(
                  {slot: bnToNum(step.checks.head.slot), root: step.checks.head.root},
                  `Invalid head at step ${i}`
                );
                // Gloas and later: payload_status is nested inside the head check
                if (step.checks.head.payload_status !== undefined) {
                  expect(payloadStatusToSpec[head.payloadStatus]).toEqualWithMessage(
                    bnToNum(step.checks.head.payload_status),
                    `Invalid head payload status at step ${i}`
                  );
                }
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
                  Math.floor(bnToNum(step.checks.time) / (config.SLOT_DURATION_MS / 1000)),
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
                const currentSlot = Math.floor(tickTime / (config.SLOT_DURATION_MS / 1000));
                const {proposerHead, notReorgedReason} = (chain.forkChoice as ForkChoice).getProposerHead(
                  head,
                  tickTime % (config.SLOT_DURATION_MS / 1000),
                  currentSlot
                );
                logger.debug(`Not reorged reason ${notReorgedReason} at step ${i}`);
                expect(proposerHead.blockRoot).toEqualWithMessage(
                  step.checks.get_proposer_head,
                  `Invalid proposer head at step ${i}`
                );
              }
              if (step.checks.viable_for_head_roots_and_weights !== undefined) {
                // Entries are identified by (root, payload_status, weight).
                // gloas EMPTY/FULL variants of one block root are separate entries.
                // Pre-gloas vectors omit payload_status (every pre-gloas node is FULL internally).
                const isGloas = ForkSeq[fork] >= ForkSeq.gloas;
                const expected = step.checks.viable_for_head_roots_and_weights
                  .map((entry) => ({
                    root: entry.root,
                    payloadStatus: entry.payload_status !== undefined ? bnToNum(entry.payload_status) : undefined,
                    weightGwei: entry.weight,
                  }))
                  .sort(cmpViableHead);
                const actual = (chain.forkChoice as ForkChoice)
                  .getViableHeads()
                  .map(({root, payloadStatus, weight}) => ({
                    root,
                    payloadStatus: isGloas ? payloadStatusToSpec[payloadStatus] : undefined,
                    weightGwei: weight,
                  }))
                  .sort(cmpViableHead);

                // The set of viable heads is determined by justified/finalized epochs, not weight,
                // so identity must match exactly. Comparing the full sets (not a subset) also
                // rejects a degenerate empty result.
                expect(actual.map(({root, payloadStatus}) => ({root, payloadStatus}))).toEqualWithMessage(
                  expected.map(({root, payloadStatus}) => ({root, payloadStatus})),
                  `Invalid viable head roots at step ${i}`
                );

                for (const [k, act] of actual.entries()) {
                  const exp = expected[k];
                  expect(act.weightGwei).toEqualWithMessage(
                    exp.weightGwei,
                    `Invalid viable head weight for ${act.root} at step ${i}`
                  );
                }
              }
              if (step.checks.should_override_forkchoice_update) {
                const currentSlot = Math.floor(tickTime / (config.SLOT_DURATION_MS / 1000));
                const result = chain.forkChoice.shouldOverrideForkChoiceUpdate(
                  head,
                  tickTime % (config.SLOT_DURATION_MS / 1000),
                  currentSlot
                );
                if (result.shouldOverrideFcu === false) {
                  logger.debug(`Not override fcu reason ${result.reason} at step ${i}`);
                }
                expect({result: result.shouldOverrideFcu, validator_is_connected: true}).toEqualWithMessage(
                  step.checks.should_override_forkchoice_update,
                  `Invalid should override fcu result at step ${i}`
                );
              }
              if (step.checks.payload_timeliness_vote) {
                expect(
                  chain.forkChoice.getPayloadTimelinessVotes(step.checks.payload_timeliness_vote.block_root)
                ).toEqualWithMessage(
                  step.checks.payload_timeliness_vote.votes,
                  `Invalid payload timeliness votes at step ${i}`
                );
              }
              if (step.checks.payload_data_availability_vote) {
                expect(
                  chain.forkChoice.getPayloadDataAvailabilityVotes(
                    step.checks.payload_data_availability_vote.block_root
                  )
                ).toEqualWithMessage(
                  step.checks.payload_data_availability_vote.votes,
                  `Invalid payload data availability votes at step ${i}`
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
          [COLUMN_FILE_NAME]: ssz.fulu.DataColumnSidecar,
          [EXECUTION_PAYLOAD_ENVELOPE_FILE_NAME]: ssz.gloas.SignedExecutionPayloadEnvelope,
          [ATTESTATION_FILE_NAME]: sszTypesFor(fork).Attestation,
          [ATTESTER_SLASHING_FILE_NAME]: sszTypesFor(fork).AttesterSlashing,
          [PAYLOAD_ATTESTATION_MESSAGE_FILE_NAME]: ssz.gloas.PayloadAttestationMessage,
        },
        mapToTestCase: (t: Record<string, any>) => {
          // t has input file name as key
          const blocks = new Map<string, SignedBeaconBlock>();
          const blobs = new Map<string, deneb.Blobs>();
          const columns = new Map<string, fulu.DataColumnSidecar>();
          const executionPayloadEnvelopes = new Map<string, gloas.SignedExecutionPayloadEnvelope>();
          const attestations = new Map<string, Attestation>();
          const attesterSlashings = new Map<string, AttesterSlashing>();
          const payloadAttestationMessages = new Map<string, PayloadAttestationMessage>();
          for (const key in t) {
            if (!Object.prototype.hasOwnProperty.call(t, key)) continue;

            const blockMatch = key.match(BLOCK_FILE_NAME);
            if (blockMatch) {
              blocks.set(key, t[key]);
            }
            const blobsMatch = key.match(BLOBS_FILE_NAME);
            if (blobsMatch) {
              blobs.set(key, t[key]);
            }
            const columnMatch = key.match(COLUMN_FILE_NAME);
            if (columnMatch) {
              columns.set(key, t[key]);
            }
            const envelopeMatch = key.match(EXECUTION_PAYLOAD_ENVELOPE_FILE_NAME);
            if (envelopeMatch) {
              executionPayloadEnvelopes.set(key, t[key]);
            }
            const attMatch = key.match(ATTESTATION_FILE_NAME);
            if (attMatch) {
              attestations.set(key, t[key]);
            }
            const attesterSlashingMatch = key.match(ATTESTER_SLASHING_FILE_NAME);
            if (attesterSlashingMatch) {
              attesterSlashings.set(key, t[key]);
            }
            const payloadAttestationMessageMatch = key.match(PAYLOAD_ATTESTATION_MESSAGE_FILE_NAME);
            if (payloadAttestationMessageMatch) {
              payloadAttestationMessages.set(key, t[key]);
            }
          }
          return {
            meta: t["meta"] as ForkChoiceTestCase["meta"],
            anchorState: t[ANCHOR_STATE_FILE_NAME] as ForkChoiceTestCase["anchorState"],
            anchorBlock: t[ANCHOR_BLOCK_FILE_NAME] as ForkChoiceTestCase["anchorBlock"],
            steps: t["steps"] as ForkChoiceTestCase["steps"],
            blocks,
            blobs,
            columns,
            executionPayloadEnvelopes,
            attestations,
            attesterSlashings,
            payloadAttestationMessages,
          };
        },
        // timeout needs to be set longer than BLOB_AVAILABILITY_TIMEOUT so that on_block_peerdas__not_available fails
        timeout: 15000,
        expectFunc: () => {},
        // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
        // EXCEPTION : this test skipped here because prefix match can't be don't for this particular test
        // as testId for the entire directory is same : `deneb/fork_choice/on_block/pyspec_tests` and
        // we just want to skip this one particular test because we don't have minimal kzg lib integrated
        //
        // This skip can be removed once a kzg lib with run-time minimal blob size setup is released and
        // integrated
        shouldSkip: (_testcase, name, _index) =>
          name.includes("invalid_incorrect_proof") ||
          // TODO GLOAS: These tests will be unskipped by https://github.com/ChainSafe/lodestar/pull/9233
          ((name.includes("gloas") || name.includes("heze")) &&
            (name.includes("simple_attempted_reorg_without_enough_ffg_votes") ||
              name.includes("include_votes_another_empty_chain_with_enough_ffg_votes_current_epoch") ||
              name.includes("include_votes_another_empty_chain_with_enough_ffg_votes_previous_epoch") ||
              name.includes("include_votes_another_empty_chain_without_enough_ffg_votes_current_epoch"))),
      },
    };
  };

function toSpecTestCheckpoint(checkpoint: CheckpointWithHex): SpecTestCheckpoint {
  return {
    epoch: BigInt(checkpoint.epoch),
    root: checkpoint.rootHex,
  };
}

type Step =
  | OnTick
  | OnAttestation
  | OnAttesterSlashing
  | OnPayloadAttestationMessage
  | OnBlock
  | OnExecutionPayloadEnvelope
  | OnPayloadInfo
  | Checks;

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

type OnPayloadAttestationMessage = {
  /**
   * the name of the `payload_attestation_message_<32-byte-root>.ssz_snappy` file.
   * To execute `on_payload_attestation_message(store, payload_attestation_message)`.
   */
  payload_attestation_message: string;
  /** optional, default to `true` */
  valid?: number;
};

type OnBlock = {
  /** the name of the `block_<32-byte-root>.ssz_snappy` file. To execute `on_block(store, block)` */
  block: string;
  blobs?: string;
  proofs?: string[];
  columns?: string[];
  /** optional, default to `true`. */
  valid?: number;
};

type OnExecutionPayloadEnvelope = {
  /** the name of the execution_payload_envelope file */
  execution_payload: string;
  /** optional, default to `true`. */
  valid?: number;
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
      /** Gloas and later */
      payload_status?: bigint;
    };
    time?: bigint;
    justified_checkpoint?: SpecTestCheckpoint;
    finalized_checkpoint?: SpecTestCheckpoint;
    proposer_boost_root?: RootHex;
    get_proposer_head?: string;
    should_override_forkchoice_update?: {
      validator_is_connected: boolean;
      result: boolean;
    };
    /** Gloas: PTC timeliness votes per PTC position (`null` = member has not attested). */
    payload_timeliness_vote?: {
      block_root: RootHex;
      votes: (boolean | null)[];
    };
    /** Gloas: PTC data-availability votes per PTC position (`null` = member has not attested). */
    payload_data_availability_vote?: {
      block_root: RootHex;
      votes: (boolean | null)[];
    };
    viable_for_head_roots_and_weights?: {root: RootHex; weight: bigint; payload_status?: bigint}[];
  };
};

/** Sort by (root, payload_status) — the spec fixes no order; gloas variants share a root. */
function cmpViableHead(a: {root: string; payloadStatus?: number}, b: {root: string; payloadStatus?: number}): number {
  return a.root.localeCompare(b.root) || (a.payloadStatus ?? 0) - (b.payloadStatus ?? 0);
}

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
  columns: Map<string, fulu.DataColumnSidecar>;
  executionPayloadEnvelopes: Map<string, gloas.SignedExecutionPayloadEnvelope>;
  attestations: Map<string, Attestation>;
  attesterSlashings: Map<string, AttesterSlashing>;
  payloadAttestationMessages: Map<string, PayloadAttestationMessage>;
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

function isPayloadAttestationMessage(step: Step): step is OnPayloadAttestationMessage {
  return typeof (step as OnPayloadAttestationMessage).payload_attestation_message === "string";
}

function isBlock(step: Step): step is OnBlock {
  return typeof (step as OnBlock).block === "string";
}

function isExecutionPayload(step: Step): step is OnExecutionPayloadEnvelope {
  return typeof (step as OnExecutionPayloadEnvelope).execution_payload === "string";
}

function isOnPayloadInfoStep(step: Step): step is OnPayloadInfo {
  return typeof (step as OnPayloadInfo).block_hash === "string";
}

function isCheck(step: Step): step is Checks {
  return typeof (step as Checks).checks === "object";
}
