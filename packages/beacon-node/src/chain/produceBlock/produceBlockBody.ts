import {ChainForkConfig} from "@lodestar/config";
import {ProtoBlock} from "@lodestar/fork-choice";
import {
  BUILDER_INDEX_SELF_BUILD,
  ForkName,
  ForkPostBellatrix,
  ForkPostCapella,
  ForkPostDeneb,
  ForkPostFulu,
  ForkPostGloas,
  ForkPreGloas,
  ForkSeq,
  isForkPostAltair,
  isForkPostBellatrix,
  isForkPostGloas,
} from "@lodestar/params";
import {G2_POINT_AT_INFINITY, computeTimeAtSlot, getExpectedGasLimit} from "@lodestar/state-transition";
import {
  BLSPubkey,
  BLSSignature,
  BeaconBlock,
  BeaconBlockBody,
  BlindedBeaconBlock,
  BlindedBeaconBlockBody,
  BlobsBundle,
  Bytes32,
  ExecutionPayload,
  ExecutionPayloadHeader,
  Root,
  RootHex,
  SSEPayloadAttributes,
  Slot,
  ValidatorIndex,
  Wei,
  altair,
  capella,
  deneb,
  electra,
  fulu,
  gloas,
  ssz,
} from "@lodestar/types";
import {GWEI_TO_WEI, Logger, fromHex, sleep, toHex, toPubkeyHex, toRootHex} from "@lodestar/utils";
import {numToQuantity} from "../../execution/engine/utils.js";
import {IExecutionBuilder, IExecutionEngine, PayloadAttributes, PayloadId} from "../../execution/index.js";
import {fromGraffitiBytes} from "../../util/graffiti.js";
import {kzg} from "../../util/kzg.js";
import type {BeaconChain} from "../chain.js";
import {CommonBlockBody} from "../interface.js";
import {validateBlobsAndKzgCommitments, validateCellsAndKzgCommitments} from "./validateBlobsAndKzgCommitments.js";

// Time to provide the EL to generate a payload from new payload id
const PAYLOAD_GENERATION_TIME_MS = 500;

export enum PayloadPreparationType {
  Fresh = "Fresh",
  Cached = "Cached",
  Reorged = "Reorged",
  Blinded = "Blinded",
}

/**
 * Block production steps tracked in metrics
 */
export enum BlockProductionStep {
  proposerSlashing = "proposerSlashing",
  attesterSlashings = "attesterSlashings",
  voluntaryExits = "voluntaryExits",
  blsToExecutionChanges = "blsToExecutionChanges",
  attestations = "attestations",
  syncAggregate = "syncAggregate",
  executionPayload = "executionPayload",
}

export type BlockAttributes = {
  randaoReveal: BLSSignature;
  graffiti: Bytes32;
  slot: Slot;
  parentBlock: ProtoBlock;
  feeRecipient?: string;
  /** When provided, build block with this builder bid instead of a self-build bid */
  builderBid?: gloas.SignedExecutionPayloadBid;
};

/**
 * Scalars precomputed once by `BeaconEngine.produceBlockBase` and threaded through production so the
 * downstream flow does not recompute the same forkChoice / base-state reads. Optional: pre-gloas
 * callers (`produceBlockV3`) don't supply them yet, so `produceBlockBody` falls back to computing them.
 */
export type PreparedBlockScalars = {
  proposerIndex: ValidatorIndex;
  proposerPubKey: BLSPubkey;
  safeBlockHash: RootHex;
  finalizedBlockHash: RootHex;
  timestamp: number;
  prevRandao: Bytes32;
  parentBlockHash: Bytes32;
  parentGasLimit: number;
  isBuildingOnFull: boolean;
  // gloas: parent execution requests applied to produce the (already-filtered) common body, and the
  // payload-attribute withdrawals resolved from that same applied state.
  parentExecutionRequests: gloas.ExecutionRequests;
  // gloas: payload attestations for the parent block's payload (slot - 1), collected from the pool once.
  payloadAttestations: gloas.PayloadAttestation[];
  withdrawals?: PayloadAttributesWithdrawals;
  // gloas: proposer target gas limit resolved by produceBlockBase; passed to prepareExecutionPayload.
  targetGasLimit?: number;
};

export enum BlockType {
  Full = "Full",
  Blinded = "Blinded",
}
export type AssembledBodyType<T extends BlockType> = T extends BlockType.Full
  ? BeaconBlockBody
  : BlindedBeaconBlockBody;
export type AssembledBlockType<T extends BlockType> = T extends BlockType.Full ? BeaconBlock : BlindedBeaconBlock;

export type ProduceFullGloas = {
  type: BlockType.Full;
  fork: ForkPostGloas;
  executionPayload: ExecutionPayload<ForkPostGloas>;
  executionRequests: gloas.ExecutionRequests;
  blobsBundle: BlobsBundle<ForkPostGloas>;
  cells: fulu.Cell[][];
  parentBlockRoot: Root;
};
export type ProduceFullFulu = {
  type: BlockType.Full;
  fork: ForkPostFulu;
  executionPayload: ExecutionPayload<ForkPostFulu>;
  blobsBundle: BlobsBundle<ForkPostFulu>;
  cells: fulu.Cell[][];
};
export type ProduceFullDeneb = {
  type: BlockType.Full;
  fork: ForkName.deneb | ForkName.electra;
  executionPayload: ExecutionPayload<ForkPostDeneb>;
  blobsBundle: BlobsBundle<ForkPostDeneb>;
};
export type ProduceFullBellatrix = {
  type: BlockType.Full;
  fork: ForkName.bellatrix | ForkName.capella;
  executionPayload: ExecutionPayload<ForkPostBellatrix>;
};
export type ProduceFullPhase0 = {
  type: BlockType.Full;
  fork: ForkName.phase0 | ForkName.altair;
};
export type ProduceBlinded = {
  type: BlockType.Blinded;
  fork: ForkName;
};

// The results of block production returned by `produceBlockBody`
// The types are defined separately so typecasting can be used

/** The result of local block production, everything that's not the block itself */
export type ProduceResult =
  | ProduceFullGloas
  | ProduceFullFulu
  | ProduceFullDeneb
  | ProduceFullBellatrix
  | ProduceFullPhase0
  | ProduceBlinded;

export async function produceBlockBody<T extends BlockType>(
  this: BeaconChain,
  blockType: T,
  // All scalars are precomputed once by `BeaconEngine.produceBlockBase` (both V3 and V4 routes) and
  // threaded here, so `produceBlockBody` no longer needs the `BeaconState` — it reads the scalars directly.
  blockAttr: BlockAttributes & {
    commonBlockBodyPromise: Promise<CommonBlockBody>;
  } & PreparedBlockScalars
): Promise<{
  body: AssembledBodyType<T>;
  produceResult: ProduceResult;
  executionPayloadValue: Wei;
  shouldOverrideBuilder?: boolean;
}> {
  const {
    slot: blockSlot,
    feeRecipient: requestedFeeRecipient,
    parentBlock,
    proposerIndex,
    proposerPubKey,
    commonBlockBodyPromise,
    builderBid,
    // Precomputed by produceBlockBase (gloas/V4); undefined on the V3 path → computed via `??` below
    safeBlockHash: preparedSafeBlockHash,
    finalizedBlockHash: preparedFinalizedBlockHash,
    timestamp: preparedTimestamp,
    prevRandao: preparedPrevRandao,
    parentBlockHash: preparedParentBlockHash,
    parentGasLimit: preparedParentGasLimit,
    isBuildingOnFull: preparedIsBuildingOnFull,
    parentExecutionRequests: preparedParentExecutionRequests,
    payloadAttestations: preparedPayloadAttestations,
    withdrawals: preparedWithdrawals,
    targetGasLimit: preparedTargetGasLimit,
  } = blockAttr;
  let executionPayloadValue: Wei;
  let blockBody: AssembledBodyType<T>;
  const parentBlockRoot = fromHex(parentBlock.blockRoot);
  // even though shouldOverrideBuilder is relevant for the engine response, for simplicity of typing
  // we just return it undefined for the builder which anyway doesn't get consumed downstream
  let shouldOverrideBuilder: boolean | undefined;
  const fork = this.config.getForkName(blockSlot);
  const produceResult = {
    type: blockType,
    fork,
  } as ProduceResult;

  const logMeta: Record<string, string | number | bigint> = {
    fork,
    blockType,
    slot: blockSlot,
  };
  this.logger.verbose("Producing beacon block body", logMeta);

  if (builderBid !== undefined) {
    // parentExecutionRequests was applied by produceBlockBase to build the common body; the bid
    // lookup is gated by isBuildingOnFull so it agrees with this bid's extend decision.
    executionPayloadValue = BigInt(builderBid.message.value) * GWEI_TO_WEI;

    const commonBlockBody = await commonBlockBodyPromise;
    const gloasBody = Object.assign({}, commonBlockBody) as gloas.BeaconBlockBody;
    gloasBody.signedExecutionPayloadBid = builderBid;
    gloasBody.payloadAttestations = preparedPayloadAttestations;
    gloasBody.parentExecutionRequests = preparedParentExecutionRequests;
    // gloasBody.voluntaryExits keep the common body's exits — already valid against the applied state.
    blockBody = gloasBody as AssembledBodyType<T>;

    this.logger.verbose("Produced block with builder bid", {
      slot: blockSlot,
      builderIndex: builderBid.message.builderIndex,
      bidValue: builderBid.message.value,
      parentBlockHash: toRootHex(builderBid.message.parentBlockHash),
      parentBlockRoot: toRootHex(builderBid.message.parentBlockRoot),
      blockHash: toRootHex(builderBid.message.blockHash),
    });
  } else if (isForkPostGloas(fork)) {
    // TODO GLOAS: support non self-building here, the block type differentiation between
    // full and blinded no longer makes sense in gloas, it might be a good idea to move
    // this into a completely separate function and have pre/post gloas more separated
    // TODO GLOAS: post-Gloas, proposer feeRecipient is also carried (signed) in
    // ProposerPreferencesPool. Consider using this unified cache instead
    // see https://github.com/ChainSafe/lodestar/issues/9379
    const feeRecipient = requestedFeeRecipient ?? this.beaconProposerCache.getOrDefault(proposerIndex);

    const endExecutionPayload = this.metrics?.executionBlockProductionTimeSteps.startTimer();

    const prepareRes = await prepareExecutionPayload(
      this,
      this.logger,
      fork,
      parentBlockRoot,
      preparedParentBlockHash,
      preparedSafeBlockHash,
      preparedFinalizedBlockHash,
      blockSlot,
      {
        timestamp: preparedTimestamp,
        prevRandao: preparedPrevRandao,
        withdrawals: preparedWithdrawals,
      },
      feeRecipient,
      preparedTargetGasLimit
    );

    const {prepType, payloadId} = prepareRes;
    Object.assign(logMeta, {executionPayloadPrepType: prepType});

    this.logger.verbose("Prepared execution payload from engine", {
      slot: blockSlot,
      parentBlockRoot: toRootHex(parentBlockRoot),
      parentBlockHash: toRootHex(preparedParentBlockHash),
      feeRecipient,
      prepType,
      payloadId,
      isBuildingOnFull: preparedIsBuildingOnFull,
    });

    if (prepType !== PayloadPreparationType.Cached) {
      await sleep(PAYLOAD_GENERATION_TIME_MS);
    }

    this.logger.verbose("Fetching execution payload from engine", {slot: blockSlot, payloadId});
    const payloadRes = await this.executionEngine.getPayload(fork, payloadId);

    endExecutionPayload?.({step: BlockProductionStep.executionPayload});

    const {executionPayload, blobsBundle, executionRequests} = payloadRes;
    executionPayloadValue = payloadRes.executionPayloadValue;
    shouldOverrideBuilder = payloadRes.shouldOverrideBuilder;

    if (blobsBundle === undefined) {
      throw Error(`Missing blobsBundle response from getPayload at fork=${fork}`);
    }
    if (executionRequests === undefined) {
      throw Error(`Missing executionRequests response from getPayload at fork=${fork}`);
    }

    const cells = blobsBundle.blobs.map((blob) => kzg.computeCells(blob));
    if (this.opts.sanityCheckExecutionEngineBlobs) {
      await validateCellsAndKzgCommitments(blobsBundle.commitments, blobsBundle.proofs, cells);
    }

    // Create self-build execution payload bid
    const bid: gloas.ExecutionPayloadBid = {
      parentBlockHash: preparedParentBlockHash,
      parentBlockRoot,
      blockHash: executionPayload.blockHash,
      prevRandao: preparedPrevRandao,
      feeRecipient: executionPayload.feeRecipient,
      gasLimit: executionPayload.gasLimit,
      builderIndex: BUILDER_INDEX_SELF_BUILD,
      slot: blockSlot,
      value: 0,
      executionPayment: 0,
      blobKzgCommitments: blobsBundle.commitments,
      executionRequestsRoot: ssz.gloas.ExecutionRequests.hashTreeRoot(executionRequests as gloas.ExecutionRequests),
    };
    const signedBid: gloas.SignedExecutionPayloadBid = {
      message: bid,
      signature: G2_POINT_AT_INFINITY,
    };

    const commonBlockBody = await commonBlockBodyPromise;
    const gloasBody = Object.assign({}, commonBlockBody) as gloas.BeaconBlockBody;
    gloasBody.signedExecutionPayloadBid = signedBid;
    gloasBody.payloadAttestations = preparedPayloadAttestations;
    gloasBody.parentExecutionRequests = preparedParentExecutionRequests;
    // gloasBody.voluntaryExits keep the common body's exits — already valid against the applied state.
    blockBody = gloasBody as AssembledBodyType<T>;

    // Store execution payload data required to construct execution payload envelope later
    const gloasResult = produceResult as ProduceFullGloas;
    gloasResult.executionPayload = executionPayload as ExecutionPayload<ForkPostGloas>;
    gloasResult.executionRequests = executionRequests as gloas.ExecutionRequests;
    gloasResult.blobsBundle = blobsBundle;
    gloasResult.cells = cells;
    gloasResult.parentBlockRoot = fromHex(parentBlock.blockRoot);

    const fetchedTime = Date.now() / 1000 - computeTimeAtSlot(this.config, blockSlot, this.genesisTime);
    this.metrics?.blockPayload.payloadFetchedTime.observe({prepType}, fetchedTime);
    this.logger.verbose("Produced block with self-build bid", {
      slot: blockSlot,
      executionPayloadValue,
      prepType,
      payloadId,
      fetchedTime,
      executionBlockHash: toRootHex(executionPayload.blockHash),
      blobs: blobsBundle.commitments.length,
      gasLimit: executionPayload.gasLimit,
    });

    Object.assign(logMeta, {
      transactions: executionPayload.transactions.length,
      blobs: blobsBundle.commitments.length,
      shouldOverrideBuilder,
    });
  } else if (isForkPostBellatrix(fork)) {
    const feeRecipient = requestedFeeRecipient ?? this.beaconProposerCache.getOrDefault(proposerIndex);
    const feeRecipientType = requestedFeeRecipient
      ? "requested"
      : this.beaconProposerCache.get(proposerIndex)
        ? "cached"
        : "default";

    Object.assign(logMeta, {feeRecipientType, feeRecipient});

    const payloadAttributesInput: PayloadAttributesInput = {
      timestamp: preparedTimestamp,
      prevRandao: preparedPrevRandao,
      withdrawals: preparedWithdrawals,
    };

    if (blockType === BlockType.Blinded) {
      if (!this.executionBuilder) throw Error("External builder not configured");
      const executionBuilder = this.executionBuilder;

      const builderPromise = (async () => {
        const endExecutionPayloadHeader = this.metrics?.builderBlockProductionTimeSteps.startTimer();
        // This path will not be used in the production, but is here just for merge mock
        // tests because merge-mock requires an fcU to be issued prior to fetch payload
        // header.
        if (executionBuilder.issueLocalFcUWithFeeRecipient !== undefined) {
          await prepareExecutionPayload(
            this,
            this.logger,
            fork,
            parentBlockRoot,
            preparedParentBlockHash,
            preparedSafeBlockHash,
            preparedFinalizedBlockHash,
            blockSlot,
            payloadAttributesInput,
            executionBuilder.issueLocalFcUWithFeeRecipient,
            preparedTargetGasLimit
          );
        }

        // For MeV boost integration, this is where the execution header will be
        // fetched from the payload id and a blinded block will be produced instead of
        // fullblock for the validator to sign
        this.logger.verbose("Fetching execution payload header from builder", {
          slot: blockSlot,
          proposerPubKey: toHex(proposerPubKey),
        });
        const headerRes = await prepareExecutionPayloadHeader(
          this,
          fork,
          preparedParentBlockHash,
          blockSlot,
          proposerPubKey
        );

        endExecutionPayloadHeader?.({
          step: BlockProductionStep.executionPayload,
        });

        return headerRes;
      })();

      const [builderRes, commonBlockBody] = await Promise.all([builderPromise, commonBlockBodyPromise]);
      blockBody = Object.assign({}, commonBlockBody) as AssembledBodyType<BlockType.Blinded>;

      (blockBody as BlindedBeaconBlockBody).executionPayloadHeader = builderRes.header;
      executionPayloadValue = builderRes.executionPayloadValue;

      const fetchedTime = Date.now() / 1000 - computeTimeAtSlot(this.config, blockSlot, this.genesisTime);
      const prepType = PayloadPreparationType.Blinded;
      this.metrics?.blockPayload.payloadFetchedTime.observe({prepType}, fetchedTime);
      this.logger.verbose("Fetched execution payload header from builder", {
        slot: blockSlot,
        executionPayloadValue,
        prepType,
        fetchedTime,
      });

      const targetGasLimit = executionBuilder.getValidatorRegistration(proposerPubKey)?.gasLimit;
      if (!targetGasLimit) {
        // This should only happen if cache was cleared due to restart of beacon node
        this.logger.warn("Failed to get validator registration, could not check header gas limit", {
          slot: blockSlot,
          proposerIndex,
          proposerPubKey: toPubkeyHex(proposerPubKey),
        });
      } else {
        const headerGasLimit = builderRes.header.gasLimit;
        const expectedGasLimit = getExpectedGasLimit(preparedParentGasLimit, targetGasLimit);

        const lowerBound = Math.min(preparedParentGasLimit, expectedGasLimit);
        const upperBound = Math.max(preparedParentGasLimit, expectedGasLimit);

        if (headerGasLimit < lowerBound || headerGasLimit > upperBound) {
          throw Error(
            `Header gas limit ${headerGasLimit} is outside of acceptable range [${lowerBound}, ${upperBound}]`
          );
        }

        if (headerGasLimit !== expectedGasLimit) {
          this.logger.warn("Header gas limit does not match expected value", {
            slot: blockSlot,
            headerGasLimit,
            expectedGasLimit,
            parentGasLimit: preparedParentGasLimit,
            targetGasLimit,
          });
        }
      }

      if (ForkSeq[fork] >= ForkSeq.deneb) {
        const {blobKzgCommitments} = builderRes;
        if (blobKzgCommitments === undefined) {
          throw Error(`Invalid builder getHeader response for fork=${fork}, missing blobKzgCommitments`);
        }

        (blockBody as deneb.BlindedBeaconBlockBody).blobKzgCommitments = blobKzgCommitments;
        Object.assign(logMeta, {blobs: blobKzgCommitments.length});
      }

      if (ForkSeq[fork] >= ForkSeq.electra) {
        const {executionRequests} = builderRes;
        if (executionRequests === undefined) {
          throw Error(`Invalid builder getHeader response for fork=${fork}, missing executionRequests`);
        }
        (blockBody as electra.BlindedBeaconBlockBody).executionRequests = executionRequests;
      }
    }

    // blockType === BlockType.Full
    else {
      // enginePromise only supports pre-gloas
      const enginePromise = (async () => {
        const endExecutionPayload = this.metrics?.executionBlockProductionTimeSteps.startTimer();

        this.logger.verbose("Preparing execution payload from engine", {
          slot: blockSlot,
          parentBlockRoot: toRootHex(parentBlockRoot),
          feeRecipient,
        });
        // https://github.com/ethereum/consensus-specs/blob/v1.6.1/specs/deneb/validator.md#constructing-the-beaconblockbody
        const prepareRes = await prepareExecutionPayload(
          this,
          this.logger,
          fork,
          parentBlockRoot,
          preparedParentBlockHash,
          preparedSafeBlockHash,
          preparedFinalizedBlockHash,
          blockSlot,
          payloadAttributesInput,
          feeRecipient,
          preparedTargetGasLimit
        );

        const {prepType, payloadId} = prepareRes;
        Object.assign(logMeta, {executionPayloadPrepType: prepType});

        if (prepType !== PayloadPreparationType.Cached) {
          // Wait for 500ms to allow EL to add some txs to the payload
          // the pitfalls of this have been put forward here, but 500ms delay for block proposal
          // seems marginal even with unhealthy network
          //
          // See: https://discord.com/channels/595666850260713488/892088344438255616/1009882079632314469
          await sleep(PAYLOAD_GENERATION_TIME_MS);
        }

        this.logger.verbose("Fetching execution payload from engine", {slot: blockSlot, payloadId});
        const payloadRes = await this.executionEngine.getPayload(fork, payloadId);

        endExecutionPayload?.({
          step: BlockProductionStep.executionPayload,
        });

        return {...prepareRes, ...payloadRes};
      })().catch((e) => {
        this.metrics?.blockPayload.payloadFetchErrors.inc();
        throw e;
      });

      const [engineRes, commonBlockBody] = await Promise.all([enginePromise, commonBlockBodyPromise]);
      blockBody = Object.assign({}, commonBlockBody) as AssembledBodyType<BlockType.Blinded>;

      {
        const {prepType, payloadId, executionPayload, blobsBundle, executionRequests} = engineRes;
        shouldOverrideBuilder = engineRes.shouldOverrideBuilder;

        (blockBody as BeaconBlockBody<ForkPostBellatrix & ForkPreGloas>).executionPayload = executionPayload;
        (produceResult as ProduceFullBellatrix).executionPayload = executionPayload;
        executionPayloadValue = engineRes.executionPayloadValue;
        Object.assign(logMeta, {transactions: executionPayload.transactions.length, shouldOverrideBuilder});

        const fetchedTime = Date.now() / 1000 - computeTimeAtSlot(this.config, blockSlot, this.genesisTime);
        this.metrics?.blockPayload.payloadFetchedTime.observe({prepType}, fetchedTime);
        this.logger.verbose("Fetched execution payload from engine", {
          slot: blockSlot,
          executionPayloadValue,
          prepType,
          payloadId,
          fetchedTime,
          executionHeadBlockHash: toRootHex(engineRes.executionPayload.blockHash),
        });
        if (executionPayload.transactions.length === 0) {
          this.metrics?.blockPayload.emptyPayloads.inc({prepType});
        }

        if (ForkSeq[fork] >= ForkSeq.fulu) {
          if (blobsBundle === undefined) {
            throw Error(`Missing blobsBundle response from getPayload at fork=${fork}`);
          }
          // NOTE: Even though the fulu.BlobsBundle type is superficially the same as deneb.BlobsBundle, it is NOT.
          // In fulu, proofs are _cell_ proofs, vs in deneb they are _blob_ proofs.

          const timer = this?.metrics?.peerDas.dataColumnSidecarComputationTime.startTimer();
          const cells = blobsBundle.blobs.map((blob) => kzg.computeCells(blob));
          timer?.();
          if (this.opts.sanityCheckExecutionEngineBlobs) {
            const validationTimer = this.metrics?.peerDas.kzgVerificationDataColumnBatchTime.startTimer();
            try {
              await validateCellsAndKzgCommitments(blobsBundle.commitments, blobsBundle.proofs, cells);
            } finally {
              validationTimer?.();
            }
          }

          (blockBody as deneb.BeaconBlockBody).blobKzgCommitments = blobsBundle.commitments;
          (produceResult as ProduceFullFulu).blobsBundle = blobsBundle;
          (produceResult as ProduceFullFulu).cells = cells;

          Object.assign(logMeta, {blobs: blobsBundle.commitments.length});
        } else if (ForkSeq[fork] >= ForkSeq.deneb) {
          if (blobsBundle === undefined) {
            throw Error(`Missing blobsBundle response from getPayload at fork=${fork}`);
          }

          if (this.opts.sanityCheckExecutionEngineBlobs) {
            await validateBlobsAndKzgCommitments(blobsBundle.commitments, blobsBundle.proofs, blobsBundle.blobs);
          }

          (blockBody as deneb.BeaconBlockBody).blobKzgCommitments = blobsBundle.commitments;
          (produceResult as ProduceFullDeneb).blobsBundle = blobsBundle;

          Object.assign(logMeta, {blobs: blobsBundle.commitments.length});
        }

        if (ForkSeq[fork] >= ForkSeq.electra) {
          if (executionRequests === undefined) {
            throw Error(`Missing executionRequests response from getPayload at fork=${fork}`);
          }
          (blockBody as electra.BeaconBlockBody).executionRequests = executionRequests;
        }
      }
    }
  } else {
    const commonBlockBody = await commonBlockBodyPromise;
    blockBody = Object.assign({}, commonBlockBody) as AssembledBodyType<T>;
    executionPayloadValue = BigInt(0);
  }

  const {graffiti, attestations, deposits, voluntaryExits, attesterSlashings, proposerSlashings} = blockBody;

  Object.assign(logMeta, {
    graffiti: fromGraffitiBytes(graffiti),
    attestations: attestations.length,
    deposits: deposits.length,
    voluntaryExits: voluntaryExits.length,
    attesterSlashings: attesterSlashings.length,
    proposerSlashings: proposerSlashings.length,
  });

  if (isForkPostAltair(fork)) {
    const {syncAggregate} = blockBody as altair.BeaconBlockBody;
    Object.assign(logMeta, {
      syncAggregateParticipants: syncAggregate.syncCommitteeBits.getTrueBitIndexes().length,
    });
  }

  if (ForkSeq[fork] >= ForkSeq.gloas) {
    const {blsToExecutionChanges, payloadAttestations} = blockBody as BeaconBlockBody<ForkPostGloas>;
    Object.assign(logMeta, {
      blsToExecutionChanges: blsToExecutionChanges.length,
      payloadAttestations: payloadAttestations.length,
    });
  } else if (ForkSeq[fork] >= ForkSeq.capella) {
    const {blsToExecutionChanges, executionPayload} = blockBody as BeaconBlockBody<ForkPostCapella & ForkPreGloas>;
    Object.assign(logMeta, {
      blsToExecutionChanges: blsToExecutionChanges.length,
    });

    // withdrawals are only available in full body
    if (blockType === BlockType.Full) {
      Object.assign(logMeta, {
        withdrawals: executionPayload.withdrawals.length,
      });
    }
  }

  Object.assign(logMeta, {executionPayloadValue});
  this.logger.verbose("Produced beacon block body", logMeta);

  return {body: blockBody as AssembledBodyType<T>, produceResult, executionPayloadValue, shouldOverrideBuilder};
}

/**
 * Produce ExecutionPayload for post-merge.
 */
export async function prepareExecutionPayload(
  chain: {
    executionEngine: IExecutionEngine;
    config: ChainForkConfig;
  },
  logger: Logger,
  fork: ForkPostBellatrix,
  parentBlockRoot: Root,
  parentBlockHash: Bytes32,
  safeBlockHash: RootHex,
  finalizedBlockHash: RootHex,
  prepareSlot: Slot,
  /**
   * Post-gloas, when extending a full parent, the input must be resolved from a state with parent
   * execution payload applied first (see `withParentPayloadApplied`).
   */
  payloadAttributesInput: PayloadAttributesInput,
  suggestedFeeRecipient: string,
  /** gloas: resolved engine-side (`getProposerTargetGasLimit`) and passed in as plain data; undefined pre-gloas */
  targetGasLimit?: number
): Promise<{prepType: PayloadPreparationType; payloadId: PayloadId}> {
  const {timestamp, prevRandao, withdrawals} = payloadAttributesInput;

  const payloadIdCached = chain.executionEngine.payloadIdCache.get({
    headBlockHash: toRootHex(parentBlockHash),
    finalizedBlockHash,
    timestamp: numToQuantity(timestamp),
    prevRandao: toHex(prevRandao),
    suggestedFeeRecipient,
  });

  // prepareExecutionPayload will throw error via notifyForkchoiceUpdate if
  // the EL returns Syncing on this request to prepare a payload
  // TODO: Handle only this case, DO NOT put a generic try / catch that discards all errors
  let payloadId: PayloadId | null;
  let prepType: PayloadPreparationType;

  if (payloadIdCached) {
    payloadId = payloadIdCached;
    prepType = PayloadPreparationType.Cached;
  } else {
    // If there was a payload assigned to this timestamp, it would imply that there some sort
    // of payload reorg, i.e. head, fee recipient or any other fcu param changed
    if (chain.executionEngine.payloadIdCache.hasPayload({timestamp: numToQuantity(timestamp)})) {
      prepType = PayloadPreparationType.Reorged;
    } else {
      prepType = PayloadPreparationType.Fresh;
    }

    const attributes: PayloadAttributes = preparePayloadAttributes(fork, targetGasLimit, {
      prepareSlot,
      parentBlockRoot,
      feeRecipient: suggestedFeeRecipient,
      timestamp,
      prevRandao,
      withdrawals,
    });

    payloadId = await chain.executionEngine.notifyForkchoiceUpdate(
      fork,
      toRootHex(parentBlockHash),
      safeBlockHash,
      finalizedBlockHash,
      attributes
    );
    logger.verbose("Prepared payload id from execution engine", {payloadId});
  }

  // Should never happen, notifyForkchoiceUpdate() with payload attributes always
  // returns payloadId
  if (payloadId === null) {
    throw Error("notifyForkchoiceUpdate returned payloadId null");
  }

  // We are only returning payloadId here because prepareExecutionPayload is also called from
  // prepareNextSlot, which is an advance call to execution engine to start building payload
  // Actual payload isn't produced till getPayload is called.
  return {payloadId, prepType};
}

async function prepareExecutionPayloadHeader(
  chain: {
    executionBuilder?: IExecutionBuilder;
    config: ChainForkConfig;
  },
  fork: ForkPostBellatrix,
  parentHash: Bytes32,
  slot: Slot,
  proposerPubKey: BLSPubkey
): Promise<{
  header: ExecutionPayloadHeader;
  executionPayloadValue: Wei;
  blobKzgCommitments?: deneb.BlobKzgCommitments;
  executionRequests?: electra.ExecutionRequests;
}> {
  if (!chain.executionBuilder) {
    throw Error("executionBuilder required");
  }

  return chain.executionBuilder.getHeader(fork, slot, parentHash, proposerPubKey);
}

export type PayloadAttributesWithdrawals = capella.SSEPayloadAttributes["payloadAttributes"]["withdrawals"];

/**
 * Plain (BeaconState-free) inputs for execution payload attributes. Produced by the engine's single
 * state reader `BeaconEngine.resolvePayloadAttributesInput`; consumed by `preparePayloadAttributes` /
 * `prepareExecutionPayload` / `getPayloadAttributesForSSE`.
 */
export type PayloadAttributesInput = {
  timestamp: number;
  prevRandao: Bytes32;
  /** undefined pre-capella */
  withdrawals?: PayloadAttributesWithdrawals;
};

export function preparePayloadAttributes(
  fork: ForkPostBellatrix,
  // gloas: resolved by the engine (see `BeaconEngine.getProposerTargetGasLimit`) and passed in as plain
  // data so this shared helper does not touch fork choice / the proposer-preferences pool; undefined pre-gloas
  targetGasLimit: number | undefined,
  {
    prepareSlot,
    parentBlockRoot,
    feeRecipient,
    timestamp,
    prevRandao,
    withdrawals,
  }: {
    prepareSlot: Slot;
    parentBlockRoot: Root;
    feeRecipient: string;
    timestamp: number;
    prevRandao: Bytes32;
    withdrawals?: PayloadAttributesWithdrawals;
  }
): SSEPayloadAttributes["payloadAttributes"] {
  const payloadAttributes = {
    timestamp,
    prevRandao,
    suggestedFeeRecipient: feeRecipient,
  };

  if (ForkSeq[fork] >= ForkSeq.capella) {
    if (withdrawals === undefined) {
      throw new Error("Expected withdrawals for post-capella payload attributes");
    }
    (payloadAttributes as capella.SSEPayloadAttributes["payloadAttributes"]).withdrawals = withdrawals;
  }

  if (ForkSeq[fork] >= ForkSeq.deneb) {
    (payloadAttributes as deneb.SSEPayloadAttributes["payloadAttributes"]).parentBeaconBlockRoot = parentBlockRoot;
  }

  if (ForkSeq[fork] >= ForkSeq.gloas) {
    if (targetGasLimit === undefined) {
      throw new Error("Expected targetGasLimit for post-gloas payload attributes");
    }
    (payloadAttributes as gloas.SSEPayloadAttributes["payloadAttributes"]).slotNumber = prepareSlot;
    (payloadAttributes as gloas.SSEPayloadAttributes["payloadAttributes"]).targetGasLimit = targetGasLimit;
  }

  return payloadAttributes;
}
