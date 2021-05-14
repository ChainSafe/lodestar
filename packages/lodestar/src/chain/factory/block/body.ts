/**
 * @module chain/blockAssembly
 */

import {List} from "@chainsafe/ssz";
import {Bytes96, Bytes32, phase0, allForks, altair, Root, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {CachedBeaconState, computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";

import {IBeaconDb} from "../../../db";
import {IEth1ForBlockProduction} from "../../../eth1";

export async function assembleBody(
  config: IBeaconConfig,
  db: IBeaconDb,
  eth1: IEth1ForBlockProduction,
  currentState: CachedBeaconState<phase0.BeaconState>,
  randaoReveal: Bytes96,
  graffiti: Bytes32,
  slot: Slot,
  parentBlockRoot: Root
): Promise<allForks.BeaconBlockBody> {
  const [proposerSlashings, attesterSlashings, attestations, voluntaryExits, {eth1Data, deposits}] = await Promise.all([
    db.proposerSlashing.values({limit: config.params.MAX_PROPOSER_SLASHINGS}),
    db.attesterSlashing.values({limit: config.params.MAX_ATTESTER_SLASHINGS}),
    db.aggregateAndProof
      .getBlockAttestations(currentState)
      .then((value) => value.slice(0, config.params.MAX_ATTESTATIONS)),
    db.voluntaryExit.values({limit: config.params.MAX_VOLUNTARY_EXITS}),
    eth1.getEth1DataAndDeposits(currentState as CachedBeaconState<allForks.BeaconState>),
  ]);

  const blockCommon: phase0.BeaconBlockBody = {
    randaoReveal,
    graffiti,
    eth1Data,
    proposerSlashings: proposerSlashings as List<phase0.ProposerSlashing>,
    attesterSlashings: attesterSlashings as List<phase0.AttesterSlashing>,
    attestations: attestations as List<phase0.Attestation>,
    deposits: deposits as List<phase0.Deposit>,
    voluntaryExits: voluntaryExits as List<phase0.SignedVoluntaryExit>,
  };

  if (computeEpochAtSlot(config, slot) >= config.params.ALTAIR_FORK_EPOCH) {
    const block: altair.BeaconBlockBody = {
      ...blockCommon,
      syncAggregate: db.syncCommitteeContribution.getSyncAggregate(slot, parentBlockRoot),
    };
    return block;
  } else {
    return blockCommon;
  }
}

/** process_sync_committee_contributions is implemented in syncCommitteeContribution.getSyncAggregate */
