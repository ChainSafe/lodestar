import {
  Bytes32,
  phase0,
  allForks,
  altair,
  Root,
  RootHex,
  Slot,
  ssz,
  ValidatorIndex,
  BLSPubkey,
  BLSSignature,
  capella,
  deneb,
  Wei,
} from "@lodestar/types";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateCapella,
  CachedBeaconStateBellatrix,
  CachedBeaconStateExecutions,
  computeEpochAtSlot,
  computeTimeAtSlot,
  getRandaoMix,
  getCurrentEpoch,
  isMergeTransitionComplete,
  getExpectedWithdrawals,
} from "@lodestar/state-transition";
import {ChainForkConfig} from "@lodestar/config";
import {ForkSeq, ForkExecution, isForkExecution} from "@lodestar/params";
import {toHex, sleep, Logger} from "@lodestar/utils";

import type {BeaconChain} from "../chain.js";
import {PayloadId, IExecutionEngine, IExecutionBuilder, PayloadAttributes} from "../../execution/index.js";
import {ZERO_HASH, ZERO_HASH_HEX} from "../../constants/index.js";
import {IEth1ForBlockProduction} from "../../eth1/index.js";
import {numToQuantity} from "../../eth1/provider/utils.js";
import {validateBlobsAndKzgCommitments} from "./validateBlobsAndKzgCommitments.js";

// Time to provide the EL to generate a payload from new payload id
const PAYLOAD_GENERATION_TIME_MS = 500;
enum PayloadPreparationType {
  Fresh = "Fresh",
  Cached = "Cached",
  Reorged = "Reorged",
}

export type BlockAttributes = {
  randaoReveal: BLSSignature;
  graffiti: Bytes32;
  slot: Slot;
};

export enum BlockType {
  Full,
  Blinded,
}
export type AssembledBodyType<T extends BlockType> = T extends BlockType.Full
  ? allForks.BeaconBlockBody
  : allForks.BlindedBeaconBlockBody;
export type AssembledBlockType<T extends BlockType> = T extends BlockType.Full
  ? allForks.BeaconBlock
  : allForks.BlindedBeaconBlock;

export enum BlobsResultType {
  preDeneb,
  produced,
  blinded,
}

export type BlobsResult =
  | {type: BlobsResultType.preDeneb | BlobsResultType.blinded}
  | {type: BlobsResultType.produced; blobs: deneb.Blobs; blockHash: RootHex};

export async function produceBlockBody<T extends BlockType>(
  this: BeaconChain,
  blockType: T,
  currentState: CachedBeaconStateAllForks,
  {
    randaoReveal,
    graffiti,
    slot: blockSlot,
    parentSlot,
    parentBlockRoot,
    proposerIndex,
    proposerPubKey,
  }: BlockAttributes & {
    parentSlot: Slot;
    parentBlockRoot: Root;
    proposerIndex: ValidatorIndex;
    proposerPubKey: BLSPubkey;
  }
): Promise<{body: AssembledBodyType<T>; blobs: BlobsResult; blockValue: Wei}> {
  // Type-safe for blobs variable. Translate 'null' value into 'preDeneb' enum
  // TODO: Not ideal, but better than just using null.
  // TODO: Does not guarantee that preDeneb enum goes with a preDeneb block
  let blobsResult: BlobsResult;
  let blockValue: Wei;

  // TODO:
  // Iterate through the naive aggregation pool and ensure all the attestations from there
  // are included in the operation pool.
  // for (const attestation of db.attestationPool.getAll()) {
  //   try {
  //     opPool.insertAttestation(attestation);
  //   } catch (e) {
  //     // Don't stop block production if there's an error, just create a log.
  //     logger.error("Attestation did not transfer to op pool", {}, e);
  //   }
  // }

  const [
    attesterSlashings,
    proposerSlashings,
    voluntaryExits,
    blsToExecutionChanges,
  ] = this.opPool.getSlashingsAndExits(currentState);
  const attestations = this.aggregatedAttestationPool.getAttestationsForBlock(this.forkChoice, currentState);
  const {eth1Data, deposits} = await this.eth1.getEth1DataAndDeposits(currentState);

  const blockBody: phase0.BeaconBlockBody = {
    randaoReveal,
    graffiti,
    eth1Data,
    proposerSlashings,
    attesterSlashings,
    attestations,
    deposits,
    voluntaryExits,
  };

  this.logger.verbose("Produced phase0 beacon block body", {slot: blockSlot, numAttestations: attestations.length});

  const blockEpoch = computeEpochAtSlot(blockSlot);

  if (blockEpoch >= this.config.ALTAIR_FORK_EPOCH) {
    (blockBody as altair.BeaconBlockBody).syncAggregate = this.syncContributionAndProofPool.getAggregate(
      parentSlot,
      parentBlockRoot
    );
  }

  const fork = currentState.config.getForkName(blockSlot);

  if (isForkExecution(fork)) {
    const safeBlockHash = this.forkChoice.getJustifiedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
    const finalizedBlockHash = this.forkChoice.getFinalizedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
    const feeRecipient = this.beaconProposerCache.getOrDefault(proposerIndex);

    if (blockType === BlockType.Blinded) {
      if (!this.executionBuilder) throw Error("Execution Builder not available");

      // This path will not be used in the production, but is here just for merge mock
      // tests because merge-mock requires an fcU to be issued prior to fetch payload
      // header.
      if (this.executionBuilder.issueLocalFcUForBlockProduction) {
        await prepareExecutionPayload(
          this,
          this.logger,
          fork,
          safeBlockHash,
          finalizedBlockHash ?? ZERO_HASH_HEX,
          currentState as CachedBeaconStateBellatrix,
          feeRecipient
        );
      }

      // For MeV boost integration, this is where the execution header will be
      // fetched from the payload id and a blinded block will be produced instead of
      // fullblock for the validator to sign
      const builderRes = await prepareExecutionPayloadHeader(
        this,
        fork,
        currentState as CachedBeaconStateBellatrix,
        proposerPubKey
      );
      (blockBody as allForks.BlindedBeaconBlockBody).executionPayloadHeader = builderRes.header;
      blockValue = builderRes.blockValue;
      this.logger.verbose("Fetched execution payload header from builder", {slot: blockSlot, blockValue});
      if (ForkSeq[fork] >= ForkSeq.deneb) {
        const {blobKzgCommitments} = builderRes;
        if (blobKzgCommitments === undefined) {
          throw Error(`Invalid builder getHeader response for fork=${fork}, missing blobKzgCommitments`);
        }
        (blockBody as deneb.BlindedBeaconBlockBody).blobKzgCommitments = blobKzgCommitments;
        blobsResult = {type: BlobsResultType.blinded};
      } else {
        blobsResult = {type: BlobsResultType.preDeneb};
      }
    }

    // blockType === BlockType.Full
    else {
      // try catch payload fetch here, because there is still a recovery path possible if we
      // are pre-merge. We don't care the same for builder segment as the execution block
      // will takeover if the builder flow was activated and errors
      try {
        // https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/validator.md#constructing-the-beaconblockbody
        const prepareRes = await prepareExecutionPayload(
          this,
          this.logger,
          fork,
          safeBlockHash,
          finalizedBlockHash ?? ZERO_HASH_HEX,
          currentState as CachedBeaconStateExecutions,
          feeRecipient
        );

        if (prepareRes.isPremerge) {
          (blockBody as allForks.ExecutionBlockBody).executionPayload = ssz.allForksExecution[
            fork
          ].ExecutionPayload.defaultValue();
          blobsResult = {type: BlobsResultType.preDeneb};
          blockValue = BigInt(0);
        } else {
          const {prepType, payloadId} = prepareRes;
          if (prepType !== PayloadPreparationType.Cached) {
            // Wait for 500ms to allow EL to add some txs to the payload
            // the pitfalls of this have been put forward here, but 500ms delay for block proposal
            // seems marginal even with unhealthy network
            //
            // See: https://discord.com/channels/595666850260713488/892088344438255616/1009882079632314469
            await sleep(PAYLOAD_GENERATION_TIME_MS);
          }

          const engineRes = await this.executionEngine.getPayload(fork, payloadId);
          const {executionPayload} = engineRes;
          (blockBody as allForks.ExecutionBlockBody).executionPayload = executionPayload;
          blockValue = engineRes.blockValue;

          const fetchedTime = Date.now() / 1000 - computeTimeAtSlot(this.config, blockSlot, this.genesisTime);
          this.metrics?.blockPayload.payloadFetchedTime.observe({prepType}, fetchedTime);
          this.logger.verbose("Fetched execution payload from engine", {
            slot: blockSlot,
            blockValue,
            prepType,
            payloadId,
            fetchedTime,
          });
          if (executionPayload.transactions.length === 0) {
            this.metrics?.blockPayload.emptyPayloads.inc({prepType});
          }

          if (ForkSeq[fork] >= ForkSeq.deneb) {
            // SPEC: https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/validator.md#blob-kzg-commitments
            // After retrieving the execution payload from the execution engine as specified in Bellatrix, use the
            // payload_id to retrieve blobs and blob_kzg_commitments via get_blobs_and_kzg_commitments(payload_id)
            // TODO Deneb: getBlobsBundle and getPayload must be either coupled or called in parallel to save time.
            const blobsBundle = await this.executionEngine.getBlobsBundle(payloadId);

            // Sanity check consistency between getPayload() and getBlobsBundle()
            const blockHash = toHex(executionPayload.blockHash);
            if (blobsBundle.blockHash !== blockHash) {
              throw Error(`blobsBundle incorrect blockHash ${blobsBundle.blockHash} != ${blockHash}`);
            }

            // Optionally sanity-check that the KZG commitments match the versioned hashes in the transactions
            if (this.opts.sanityCheckExecutionEngineBlobs) {
              validateBlobsAndKzgCommitments(executionPayload, blobsBundle);
            }

            (blockBody as deneb.BeaconBlockBody).blobKzgCommitments = blobsBundle.kzgs;
            blobsResult = {type: BlobsResultType.produced, blobs: blobsBundle.blobs, blockHash};
          } else {
            blobsResult = {type: BlobsResultType.preDeneb};
          }
        }
      } catch (e) {
        this.metrics?.blockPayload.payloadFetchErrors.inc();
        // ok we don't have an execution payload here, so we can assign an empty one
        // if pre-merge

        if (!isMergeTransitionComplete(currentState as CachedBeaconStateBellatrix)) {
          this.logger?.warn(
            "Fetch payload from the execution failed, however since we are still pre-merge proceeding with an empty one.",
            {},
            e as Error
          );
          (blockBody as allForks.ExecutionBlockBody).executionPayload = ssz.allForksExecution[
            fork
          ].ExecutionPayload.defaultValue();
          blobsResult = {type: BlobsResultType.preDeneb};
          blockValue = BigInt(0);
        } else {
          // since merge transition is complete, we need a valid payload even if with an
          // empty (transactions) one. defaultValue isn't gonna cut it!
          throw e;
        }
      }
    }
  } else {
    blobsResult = {type: BlobsResultType.preDeneb};
    blockValue = BigInt(0);
  }

  if (ForkSeq[fork] >= ForkSeq.capella) {
    // TODO: blsToExecutionChanges should be passed in the produceBlock call
    (blockBody as capella.BeaconBlockBody).blsToExecutionChanges = blsToExecutionChanges;
  }

  return {body: blockBody as AssembledBodyType<T>, blobs: blobsResult, blockValue};
}

/**
 * Produce ExecutionPayload for pre-merge, merge, and post-merge.
 *
 * Expects `eth1MergeBlockFinder` to be actively searching for blocks well in advance to being called.
 *
 * @returns PayloadId = pow block found, null = pow NOT found
 */
export async function prepareExecutionPayload(
  chain: {
    eth1: IEth1ForBlockProduction;
    executionEngine: IExecutionEngine;
    config: ChainForkConfig;
  },
  logger: Logger,
  fork: ForkExecution,
  safeBlockHash: RootHex,
  finalizedBlockHash: RootHex,
  state: CachedBeaconStateExecutions,
  suggestedFeeRecipient: string
): Promise<{isPremerge: true} | {isPremerge: false; prepType: PayloadPreparationType; payloadId: PayloadId}> {
  const parentHashRes = await getExecutionPayloadParentHash(chain, state);
  if (parentHashRes.isPremerge) {
    // Return null only if the execution is pre-merge
    return {isPremerge: true};
  }

  const {parentHash} = parentHashRes;
  const timestamp = computeTimeAtSlot(chain.config, state.slot, state.genesisTime);
  const prevRandao = getRandaoMix(state, state.epochCtx.epoch);

  const payloadIdCached = chain.executionEngine.payloadIdCache.get({
    headBlockHash: toHex(parentHash),
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

    const attributes: PayloadAttributes = {
      timestamp,
      prevRandao,
      suggestedFeeRecipient,
    };

    if (ForkSeq[fork] >= ForkSeq.capella) {
      attributes.withdrawals = getExpectedWithdrawals(state as CachedBeaconStateCapella).withdrawals;
    }

    payloadId = await chain.executionEngine.notifyForkchoiceUpdate(
      fork,
      toHex(parentHash),
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
  return {isPremerge: false, payloadId, prepType};
}

async function prepareExecutionPayloadHeader(
  chain: {
    eth1: IEth1ForBlockProduction;
    executionBuilder?: IExecutionBuilder;
    config: ChainForkConfig;
  },
  fork: ForkExecution,
  state: CachedBeaconStateBellatrix,
  proposerPubKey: BLSPubkey
): Promise<{
  header: allForks.ExecutionPayloadHeader;
  blockValue: Wei;
  blobKzgCommitments?: deneb.BlobKzgCommitments;
}> {
  if (!chain.executionBuilder) {
    throw Error("executionBuilder required");
  }

  const parentHashRes = await getExecutionPayloadParentHash(chain, state);

  if (parentHashRes.isPremerge) {
    // TODO: Is this okay?
    throw Error("Execution builder disabled pre-merge");
  }

  const {parentHash} = parentHashRes;
  return chain.executionBuilder.getHeader(state.slot, parentHash, proposerPubKey);
}

async function getExecutionPayloadParentHash(
  chain: {
    eth1: IEth1ForBlockProduction;
    config: ChainForkConfig;
  },
  state: CachedBeaconStateExecutions
): Promise<{isPremerge: true} | {isPremerge: false; parentHash: Root}> {
  // Use different POW block hash parent for block production based on merge status.
  // Returned value of null == using an empty ExecutionPayload value
  if (isMergeTransitionComplete(state)) {
    // Post-merge, normal payload
    return {isPremerge: false, parentHash: state.latestExecutionPayloadHeader.blockHash};
  } else {
    if (
      !ssz.Root.equals(chain.config.TERMINAL_BLOCK_HASH, ZERO_HASH) &&
      getCurrentEpoch(state) < chain.config.TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH
    )
      throw new Error(
        `InvalidMergeTBH epoch: expected >= ${
          chain.config.TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH
        }, actual: ${getCurrentEpoch(state)}`
      );

    const terminalPowBlockHash = await chain.eth1.getTerminalPowBlock();
    if (terminalPowBlockHash === null) {
      // Pre-merge, no prepare payload call is needed
      return {isPremerge: true};
    } else {
      // Signify merge via producing on top of the last PoW block
      return {isPremerge: false, parentHash: terminalPowBlockHash};
    }
  }
}

/** process_sync_committee_contributions is implemented in syncCommitteeContribution.getSyncAggregate */
