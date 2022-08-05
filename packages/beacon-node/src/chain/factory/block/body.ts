import {
  bellatrix,
  Bytes96,
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
} from "@lodestar/types";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateBellatrix,
  computeEpochAtSlot,
  computeTimeAtSlot,
  getRandaoMix,
  getCurrentEpoch,
  isMergeTransitionComplete,
} from "@lodestar/state-transition";
import {IChainForkConfig} from "@lodestar/config";
import {toHex, ILogger} from "@lodestar/utils";

import {IBeaconChain} from "../../interface.js";
import {PayloadId, IExecutionEngine, IExecutionBuilder} from "../../../execution/index.js";
import {ZERO_HASH, ZERO_HASH_HEX} from "../../../constants/index.js";
import {IEth1ForBlockProduction} from "../../../eth1/index.js";
import {numToQuantity} from "../../../eth1/provider/utils.js";

export enum BlockType {
  Full,
  Blinded,
}
export type AssembledBodyType<T extends BlockType> = T extends BlockType.Full
  ? allForks.BeaconBlockBody
  : bellatrix.BlindedBeaconBlockBody;
export type AssembledBlockType<T extends BlockType> = T extends BlockType.Full
  ? allForks.BeaconBlock
  : bellatrix.BlindedBeaconBlock;

export async function assembleBody<T extends BlockType>(
  {type, chain, logger}: {type: T; chain: IBeaconChain; logger?: ILogger},
  currentState: CachedBeaconStateAllForks,
  {
    randaoReveal,
    graffiti,
    blockSlot,
    parentSlot,
    parentBlockRoot,
    proposerIndex,
    proposerPubKey,
  }: {
    randaoReveal: Bytes96;
    graffiti: Bytes32;
    blockSlot: Slot;
    parentSlot: Slot;
    parentBlockRoot: Root;
    proposerIndex: ValidatorIndex;
    proposerPubKey: BLSPubkey;
  }
): Promise<AssembledBodyType<T>> {
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

  const [attesterSlashings, proposerSlashings, voluntaryExits] = chain.opPool.getSlashingsAndExits(currentState);
  const attestations = chain.aggregatedAttestationPool.getAttestationsForBlock(chain.forkChoice, currentState);
  const {eth1Data, deposits} = await chain.eth1.getEth1DataAndDeposits(currentState);

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

  const blockEpoch = computeEpochAtSlot(blockSlot);

  if (blockEpoch >= chain.config.ALTAIR_FORK_EPOCH) {
    (blockBody as altair.BeaconBlockBody).syncAggregate = chain.syncContributionAndProofPool.getAggregate(
      parentSlot,
      parentBlockRoot
    );
  }

  if (blockEpoch >= chain.config.BELLATRIX_FORK_EPOCH) {
    const safeBlockHash = chain.forkChoice.getJustifiedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
    const finalizedBlockHash = chain.forkChoice.getFinalizedBlock().executionPayloadBlockHash ?? ZERO_HASH_HEX;
    const feeRecipient = chain.beaconProposerCache.getOrDefault(proposerIndex);

    if (type === BlockType.Blinded) {
      if (!chain.executionBuilder) throw Error("Execution Builder not available");

      // This path will not be used in the production, but is here just for merge mock
      // tests because merge-mock requires an fcU to be issued prior to fetch payload
      // header.
      if (chain.executionBuilder.issueLocalFcUForBlockProduction) {
        await prepareExecutionPayload(
          chain,
          safeBlockHash,
          finalizedBlockHash ?? ZERO_HASH_HEX,
          currentState as CachedBeaconStateBellatrix,
          feeRecipient
        );
      }

      // For MeV boost integration, this is where the execution header will be
      // fetched from the payload id and a blinded block will be produced instead of
      // fullblock for the validator to sign
      (blockBody as bellatrix.BlindedBeaconBlockBody).executionPayloadHeader = await prepareExecutionPayloadHeader(
        chain,
        currentState as CachedBeaconStateBellatrix,
        proposerPubKey
      );
    } else {
      // try catch payload fetch here, because there is still a recovery path possible if we
      // are pre-merge. We don't care the same for builder segment as the execution block
      // will takeover if the builder flow was activated and errors
      try {
        const prepareRes = await prepareExecutionPayload(
          chain,
          safeBlockHash,
          finalizedBlockHash ?? ZERO_HASH_HEX,
          currentState as CachedBeaconStateBellatrix,
          feeRecipient
        );
        (blockBody as bellatrix.BeaconBlockBody).executionPayload = prepareRes.isPremerge
          ? ssz.bellatrix.ExecutionPayload.defaultValue()
          : await chain.executionEngine.getPayload(prepareRes.payloadId);
      } catch (e) {
        // ok we don't have an execution payload here, so we can assign an empty one
        // if pre-merge

        if (!isMergeTransitionComplete(currentState as CachedBeaconStateBellatrix)) {
          logger?.warn(
            "Fetch payload from the execution failed, however since we are still pre-merge proceeding with an empty one.",
            {},
            e as Error
          );
          (blockBody as bellatrix.BeaconBlockBody).executionPayload = ssz.bellatrix.ExecutionPayload.defaultValue();
        } else {
          // since merge transition is complete, we need a valid payload even if with an
          // empty (transactions) one. defaultValue isn't gonna cut it!
          throw e;
        }
      }
    }
  }

  return blockBody as AssembledBodyType<T>;
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
    config: IChainForkConfig;
  },
  safeBlockHash: RootHex,
  finalizedBlockHash: RootHex,
  state: CachedBeaconStateBellatrix,
  suggestedFeeRecipient: string
): Promise<{isPremerge: true} | {isPremerge: false; payloadId: PayloadId}> {
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
  const payloadId =
    payloadIdCached ??
    (await chain.executionEngine.notifyForkchoiceUpdate(toHex(parentHash), safeBlockHash, finalizedBlockHash, {
      timestamp,
      prevRandao,
      suggestedFeeRecipient,
    }));

  // Should never happen, notifyForkchoiceUpdate() with payload attributes always
  // returns payloadId
  if (payloadId === null) {
    throw Error("notifyForkchoiceUpdate returned payloadId null");
  }

  // We are only returning payloadId here because prepareExecutionPayload is also called from
  // prepareNextSlot, which is an advance call to execution engine to start building payload
  // Actual payload isn't produced till getPayload is called.
  return {isPremerge: false, payloadId};
}

async function prepareExecutionPayloadHeader(
  chain: {
    eth1: IEth1ForBlockProduction;
    executionBuilder?: IExecutionBuilder;
    config: IChainForkConfig;
  },
  state: CachedBeaconStateBellatrix,
  proposerPubKey: BLSPubkey
): Promise<bellatrix.ExecutionPayloadHeader> {
  if (!chain.executionBuilder) {
    throw Error("executionBuilder required");
  }

  const parentHashRes = await getExecutionPayloadParentHash(chain, state);

  if (parentHashRes.isPremerge) {
    // TODO: Is this okay?
    throw Error("Execution builder disabled pre-merge");
  }

  const {parentHash} = parentHashRes;
  return chain.executionBuilder.getPayloadHeader(state.slot, parentHash, proposerPubKey);
}

async function getExecutionPayloadParentHash(
  chain: {
    eth1: IEth1ForBlockProduction;
    config: IChainForkConfig;
  },
  state: CachedBeaconStateBellatrix
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
