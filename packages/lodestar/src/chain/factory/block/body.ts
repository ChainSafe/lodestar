/**
 * @module chain/blockAssembly
 */

import {List, readonlyValues} from "@chainsafe/ssz";
import {Bytes96, Bytes32, phase0, allForks, altair} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {CachedBeaconState} from "@chainsafe/lodestar-beacon-state-transition";

import {IBeaconDb} from "../../../db";
import {IEth1ForBlockProduction} from "../../../eth1";
import {intDiv} from "@chainsafe/lodestar-utils";
import bls, {Signature} from "@chainsafe/bls";

export async function assembleBody(
  config: IBeaconConfig,
  db: IBeaconDb,
  eth1: IEth1ForBlockProduction,
  currentState: CachedBeaconState<phase0.BeaconState>,
  randaoReveal: Bytes96,
  graffiti: Bytes32
): Promise<phase0.BeaconBlockBody> {
  const [proposerSlashings, attesterSlashings, attestations, voluntaryExits, {eth1Data, deposits}] = await Promise.all([
    db.proposerSlashing.values({limit: config.params.MAX_PROPOSER_SLASHINGS}),
    db.attesterSlashing.values({limit: config.params.MAX_ATTESTER_SLASHINGS}),
    db.aggregateAndProof
      .getBlockAttestations(currentState)
      .then((value) => value.slice(0, config.params.MAX_ATTESTATIONS)),
    db.voluntaryExit.values({limit: config.params.MAX_VOLUNTARY_EXITS}),
    eth1.getEth1DataAndDeposits(currentState as CachedBeaconState<allForks.BeaconState>),
  ]);

  return {
    randaoReveal,
    graffiti,
    eth1Data,
    proposerSlashings: proposerSlashings as List<phase0.ProposerSlashing>,
    attesterSlashings: attesterSlashings as List<phase0.AttesterSlashing>,
    attestations: attestations as List<phase0.Attestation>,
    deposits: deposits as List<phase0.Deposit>,
    voluntaryExits: voluntaryExits as List<phase0.SignedVoluntaryExit>,
  };
}

export function processSyncCommitteeContributions(
  config: IBeaconConfig,
  block: altair.BeaconBlock,
  contributions: Set<altair.SyncCommitteeContribution>
): void {
  const syncAggregate = config.types.altair.SyncAggregate.defaultValue();
  const signatures: Signature[] = [];
  for (const contribution of contributions) {
    const {subCommitteeIndex, aggregationBits} = contribution;
    const signature = bls.Signature.fromBytes(contribution.signature.valueOf() as Uint8Array);

    const aggBit = Array.from(readonlyValues(aggregationBits));
    for (const [index, participated] of aggBit.entries()) {
      if (participated) {
        const participantIndex =
          intDiv(config.params.SYNC_COMMITTEE_SIZE, config.params.SYNC_COMMITTEE_SUBNET_COUNT) * subCommitteeIndex +
          index;
        syncAggregate.syncCommitteeBits[participantIndex] = true;
        signatures.push(signature);
      }
    }
  }
  syncAggregate.syncCommitteeSignature = bls.Signature.aggregate(signatures).toBytes();
  block.body.syncAggregate = syncAggregate;
}
