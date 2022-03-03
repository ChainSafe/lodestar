/**
 * @module chain/blockAssembly
 */

import {List} from "@chainsafe/ssz";
import {
  Bytes96,
  Bytes32,
  phase0,
  allForks,
  altair,
  Root,
  RootHex,
  Slot,
  ssz,
  ExecutionAddress,
} from "@chainsafe/lodestar-types";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateBellatrix,
  computeEpochAtSlot,
  computeTimeAtSlot,
  getRandaoMix,
  getCurrentEpoch,
  bellatrix,
} from "@chainsafe/lodestar-beacon-state-transition";

import {IBeaconChain} from "../../interface";
import {PayloadId} from "../../../executionEngine/interface";
import {ZERO_HASH, ZERO_HASH_HEX} from "../../../constants";

export async function assembleBody(
  chain: IBeaconChain,
  currentState: CachedBeaconStateAllForks,
  {
    randaoReveal,
    graffiti,
    blockSlot,
    parentSlot,
    parentBlockRoot,
    feeRecipient,
  }: {
    randaoReveal: Bytes96;
    graffiti: Bytes32;
    blockSlot: Slot;
    parentSlot: Slot;
    parentBlockRoot: Root;
    feeRecipient: ExecutionAddress;
  }
): Promise<allForks.BeaconBlockBody> {
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
  const {eth1Data, deposits} = await chain.eth1.getEth1DataAndDeposits(currentState as CachedBeaconStateAllForks);

  const blockBody: phase0.BeaconBlockBody = {
    randaoReveal,
    graffiti,
    eth1Data,
    proposerSlashings: proposerSlashings as List<phase0.ProposerSlashing>,
    attesterSlashings: attesterSlashings as List<phase0.AttesterSlashing>,
    attestations: attestations as List<phase0.Attestation>,
    deposits: deposits as List<phase0.Deposit>,
    voluntaryExits: voluntaryExits as List<phase0.SignedVoluntaryExit>,
  };

  const blockEpoch = computeEpochAtSlot(blockSlot);

  if (blockEpoch >= chain.config.ALTAIR_FORK_EPOCH) {
    (blockBody as altair.BeaconBlockBody).syncAggregate = chain.syncContributionAndProofPool.getAggregate(
      parentSlot,
      parentBlockRoot
    );
  }

  if (blockEpoch >= chain.config.BELLATRIX_FORK_EPOCH) {
    // TODO: Optimize this flow
    // - Call prepareExecutionPayload as early as possible
    // - Call prepareExecutionPayload again if parameters change

    const finalizedBlockHash = chain.forkChoice.getFinalizedBlock().executionPayloadBlockHash;

    // prepareExecutionPayload will throw error via notifyForkchoiceUpdate if
    // the EL returns Syncing on this request to prepare a payload
    const payloadId = await prepareExecutionPayload(
      chain,
      finalizedBlockHash ?? ZERO_HASH_HEX,
      currentState as CachedBeaconStateBellatrix,
      feeRecipient
    );

    if (payloadId === null) {
      // Pre-merge, propose a pre-merge block with empty execution and keep the chain going
      (blockBody as bellatrix.BeaconBlockBody).executionPayload = ssz.bellatrix.ExecutionPayload.defaultValue();
    } else {
      (blockBody as bellatrix.BeaconBlockBody).executionPayload = await chain.executionEngine.getPayload(payloadId);
    }
  }

  return blockBody;
}

/**
 * Produce ExecutionPayload for pre-merge, merge, and post-merge.
 *
 * Expects `eth1MergeBlockFinder` to be actively searching for blocks well in advance to being called.
 *
 * @returns PayloadId = pow block found, null = pow NOT found
 */
async function prepareExecutionPayload(
  chain: IBeaconChain,
  finalizedBlockHash: RootHex,
  state: CachedBeaconStateBellatrix,
  suggestedFeeRecipient: ExecutionAddress
): Promise<PayloadId | null> {
  // Use different POW block hash parent for block production based on merge status.
  // Returned value of null == using an empty ExecutionPayload value
  let parentHash: Root;
  if (!bellatrix.isMergeTransitionComplete(state)) {
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

  const timestamp = computeTimeAtSlot(chain.config, state.slot, state.genesisTime);
  const prevRandao = getRandaoMix(state, state.currentShuffling.epoch);
  const payloadId = await chain.executionEngine.notifyForkchoiceUpdate(parentHash, finalizedBlockHash, {
    timestamp,
    prevRandao,
    suggestedFeeRecipient,
  });
  if (!payloadId) throw new Error("InvalidPayloadId: Null");
  return payloadId;
}

/** process_sync_committee_contributions is implemented in syncCommitteeContribution.getSyncAggregate */
