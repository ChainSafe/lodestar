/**
 * @module chain/blockAssembly
 */

import {List} from "@chainsafe/ssz";
import {
  ForkName,
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS,
} from "@chainsafe/lodestar-params";
import {Bytes96, Bytes32, phase0, allForks, altair, Root, Slot} from "@chainsafe/lodestar-types";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";

import {IBeaconDb} from "../../../db";
import {IEth1ForBlockProduction} from "../../../eth1";

export async function assembleBody(
  {config, db, eth1}: {config: IChainForkConfig; db: IBeaconDb; eth1: IEth1ForBlockProduction},
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

  const [proposerSlashings, attesterSlashings, attestations, voluntaryExits, {eth1Data, deposits}] = await Promise.all([
    db.proposerSlashing.values({limit: MAX_PROPOSER_SLASHINGS}),
    db.attesterSlashing.values({limit: MAX_ATTESTER_SLASHINGS}),
    db.aggregateAndProof.getBlockAttestations(currentState).then((value) => value.slice(0, MAX_ATTESTATIONS)),
    db.voluntaryExit.values({limit: MAX_VOLUNTARY_EXITS}),
    eth1.getEth1DataAndDeposits(currentState as CachedBeaconState<allForks.BeaconState>),
  ]);

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
        syncAggregate: db.syncCommitteeContribution.getSyncAggregate(
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
