/**
 * @module chain/blockAssembly
 */

import xor from "buffer-xor";
import {List, hash} from "@chainsafe/ssz";
import {Bytes96, Bytes32, phase0, allForks, altair, Root, Slot, BLSSignature, ssz} from "@chainsafe/lodestar-types";
import {
  CachedBeaconState,
  computeEpochAtSlot,
  computeTimeAtSlot,
  getCurrentEpoch,
  getRandaoMix,
  merge,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconChain} from "../../interface";

export async function assembleBody(
  chain: IBeaconChain,
  currentState: CachedBeaconState<allForks.BeaconState>,
  randaoReveal: Bytes96,
  graffiti: Bytes32,
  blockSlot: Slot,
  syncAggregateData: {parentSlot: Slot; parentBlockRoot: Root}
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

  const [attesterSlashings, proposerSlashings] = chain.opPool.getSlashings(currentState);
  const voluntaryExits = chain.opPool.getVoluntaryExits(currentState);
  const attestations = chain.aggregatedAttestationPool.getAttestationsForBlock(currentState);
  const {eth1Data, deposits} = await chain.eth1.getEth1DataAndDeposits(
    currentState as CachedBeaconState<allForks.BeaconState>
  );

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
      syncAggregateData.parentSlot,
      syncAggregateData.parentBlockRoot
    );
  }

  if (blockEpoch >= chain.config.MERGE_FORK_EPOCH) {
    (blockBody as merge.BeaconBlockBody).executionPayload = await getExecutionPayload(
      chain,
      currentState as merge.BeaconState,
      randaoReveal
    );
  }

  return blockBody;
}

/**
 * Produce ExecutionPayload for pre-merge, merge, and post-merge.
 *
 * Expects `eth1MergeBlockFinder` to be actively searching for blocks well in advance to being called.
 */
async function getExecutionPayload(
  chain: IBeaconChain,
  state: merge.BeaconState,
  randaoReveal: BLSSignature
): Promise<merge.ExecutionPayload> {
  if (!merge.isMergeComplete(state)) {
    const terminalPowBlockHash = chain.eth1.getMergeBlockHash();
    if (terminalPowBlockHash === null) {
      // Pre-merge, empty payload
      ssz.merge.ExecutionPayload.defaultValue();
    } else {
      // Signify merge via producing on top of the last PoW block
      const parentHash = terminalPowBlockHash;
      return produceExecutionPayload(chain, state, parentHash, randaoReveal);
    }
  }

  // Post-merge, normal payload
  const parentHash = state.latestExecutionPayloadHeader.blockHash;
  return produceExecutionPayload(chain, state, parentHash, randaoReveal);
}

async function produceExecutionPayload(
  chain: IBeaconChain,
  state: merge.BeaconState,
  parentHash: Root,
  randaoReveal: BLSSignature
): Promise<merge.ExecutionPayload> {
  const timestamp = computeTimeAtSlot(chain.config, state.slot, state.genesisTime);
  const randaoMix = computeRandaoMix(state, randaoReveal);

  // NOTE: This is a naive implementation that does not give sufficient time to the eth1 block to produce an optimal
  // block. Probably in the future there will exist mechanisms to optimize block production, such as giving a heads
  // up to the execution client, then calling assembleBlock. Stay up to spec updates and update accordingly.
  return chain.executionEngine.assembleBlock(parentHash, timestamp, randaoMix);
}

function computeRandaoMix(state: merge.BeaconState, randaoReveal: BLSSignature): Bytes32 {
  const epoch = getCurrentEpoch(state);
  return xor(Buffer.from(getRandaoMix(state, epoch) as Uint8Array), Buffer.from(hash(randaoReveal as Uint8Array)));
}

/** process_sync_committee_contributions is implemented in syncCommitteeContribution.getSyncAggregate */
