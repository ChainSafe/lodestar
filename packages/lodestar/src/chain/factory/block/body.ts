/**
 * @module chain/blockAssembly
 */

import {List} from "@chainsafe/ssz";
import {ForkName} from "@chainsafe/lodestar-params";
import {Bytes96, Bytes32, phase0, allForks, altair, Root, Slot} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";

import {IEth1ForBlockProduction} from "../../../eth1";
import {IBeaconChain} from "../../interface";

export async function assembleBody(
  {chain, config, eth1}: {chain: IBeaconChain; config: IChainForkConfig; eth1: IEth1ForBlockProduction},
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
  const {eth1Data, deposits} = await eth1.getEth1DataAndDeposits(
    currentState as CachedBeaconState<allForks.BeaconState>
  );

  const blockBodyPhase0: phase0.BeaconBlockBody = {
    randaoReveal,
    graffiti,
    eth1Data,
    proposerSlashings: proposerSlashings as List<phase0.ProposerSlashing>,
    attesterSlashings: attesterSlashings as List<phase0.AttesterSlashing>,
    attestations: attestations as List<phase0.Attestation>,
    deposits: deposits as List<phase0.Deposit>,
    voluntaryExits: voluntaryExits as List<phase0.SignedVoluntaryExit>,
  };

  const blockFork = config.getForkName(blockSlot);
  switch (blockFork) {
    case ForkName.phase0:
      return blockBodyPhase0;

    case ForkName.altair: {
      const block: altair.BeaconBlockBody = {
        ...blockBodyPhase0,
        syncAggregate: chain.syncContributionAndProofPool.getAggregate(
          syncAggregateData.parentSlot,
          syncAggregateData.parentBlockRoot
        ),
      };
      return block;
    }

    default:
      throw new Error(`Block processing not implemented for fork ${blockFork}`);
  }
}

/** process_sync_committee_contributions is implemented in syncCommitteeContribution.getSyncAggregate */
