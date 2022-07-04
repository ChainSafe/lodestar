/**
 * @module chain/blockAssembly
 */

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
} from "@chainsafe/lodestar-types";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateBellatrix,
  computeEpochAtSlot,
  computeTimeAtSlot,
  getRandaoMix,
  getCurrentEpoch,
  isMergeTransitionComplete,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {toHex} from "@chainsafe/lodestar-utils";

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
  {type, chain}: {type: T; chain: IBeaconChain},
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
  const attestations = chain.aggregatedAttestationPool.getAttestationsForBlock(currentState);
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

      const executionPayloadHeader = await prepareExecutionPayloadHeader(
        chain,
        currentState as CachedBeaconStateBellatrix,
        proposerPubKey
      );
      (blockBody as bellatrix.BlindedBeaconBlockBody).executionPayloadHeader = executionPayloadHeader;
    } else {
      // prepareExecutionPayload will throw error via notifyForkchoiceUpdate if
      // the EL returns Syncing on this request to prepare a payload
      try {
        const payloadId = await prepareExecutionPayload(
          chain,
          safeBlockHash,
          finalizedBlockHash ?? ZERO_HASH_HEX,
          currentState as CachedBeaconStateBellatrix,
          feeRecipient
        );
        const executionPayload = payloadId ? await chain.executionEngine.getPayload(payloadId) : null;
        if (executionPayload === null) throw Error("Empty executionPayload");
        (blockBody as bellatrix.BeaconBlockBody).executionPayload =
          executionPayload ?? ssz.bellatrix.ExecutionPayload.defaultValue();
      } catch (e) {
        // If the state is post merge, the empty/default payload will not be
        // accepted by the engine. Else we can propose with empty payload
        // and let someone else build a merge transition payload
        (blockBody as bellatrix.BeaconBlockBody).executionPayload = ssz.bellatrix.ExecutionPayload.defaultValue();
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
): Promise<PayloadId | null> {
  const parentHash = extractExecutionPayloadParentHash(chain, state);
  if (parentHash === null) return null;

  const timestamp = computeTimeAtSlot(chain.config, state.slot, state.genesisTime);
  const prevRandao = getRandaoMix(state, state.epochCtx.epoch);

  const payloadId =
    chain.executionEngine.payloadIdCache.get({
      headBlockHash: toHex(parentHash),
      finalizedBlockHash,
      timestamp: numToQuantity(timestamp),
      prevRandao: toHex(prevRandao),
      suggestedFeeRecipient,
    }) ??
    (await chain.executionEngine.notifyForkchoiceUpdate(parentHash, safeBlockHash, finalizedBlockHash, {
      timestamp,
      prevRandao,
      suggestedFeeRecipient,
    }));
  if (!payloadId) throw new Error("InvalidPayloadId: Null");
  return payloadId;
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
  if (!chain.executionBuilder) throw Error("executionBuilder required");

  const parentHash = extractExecutionPayloadParentHash(chain, state);
  if (parentHash === null) throw Error(`Invalid parentHash=${parentHash} for builder getPayloadHeader`);

  return chain.executionBuilder.getPayloadHeader(state.slot, parentHash, proposerPubKey);
}

function extractExecutionPayloadParentHash(
  chain: {
    eth1: IEth1ForBlockProduction;
    config: IChainForkConfig;
  },
  state: CachedBeaconStateBellatrix
): Root | null {
  // Use different POW block hash parent for block production based on merge status.
  // Returned value of null == using an empty ExecutionPayload value
  let parentHash: Root;
  if (!isMergeTransitionComplete(state)) {
    if (
      !ssz.Root.equals(chain.config.TERMINAL_BLOCK_HASH, ZERO_HASH) &&
      getCurrentEpoch(state) < chain.config.TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH
    )
      throw new Error(
        `InvalidMergeTBH epoch: expected >= ${
          chain.config.TERMINAL_BLOCK_HASH_ACTIVATION_EPOCH
        }, actual: ${getCurrentEpoch(state)}`
      );
    const terminalPowBlockHash = chain.eth1.getTerminalPowBlock();
    if (terminalPowBlockHash === null) {
      // Pre-merge, no prepare payload call is needed
      return null;
    } else {
      // Signify merge via producing on top of the last PoW block
      parentHash = terminalPowBlockHash;
    }
  } else {
    // Post-merge, normal payload
    parentHash = state.latestExecutionPayloadHeader.blockHash;
  }
  return parentHash;
}

/** process_sync_committee_contributions is implemented in syncCommitteeContribution.getSyncAggregate */
