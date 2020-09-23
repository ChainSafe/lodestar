/**
 * @module chain/blockAssembly
 */

import {
  BeaconBlockBody,
  BeaconState,
  Bytes96,
  Bytes32,
  ProposerSlashing,
  AttesterSlashing,
  Attestation,
  Deposit,
  SignedVoluntaryExit,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IBeaconDb} from "../../../db";
import {IEth1ForBlockProduction} from "../../../eth1";
import {TreeBacked, List} from "@chainsafe/ssz";

export async function assembleBody(
  config: IBeaconConfig,
  db: IBeaconDb,
  eth1: IEth1ForBlockProduction,
  currentState: TreeBacked<BeaconState>,
  randaoReveal: Bytes96,
  graffiti: Bytes32
): Promise<BeaconBlockBody> {
  const [proposerSlashings, attesterSlashings, attestations, voluntaryExits, {eth1Data, deposits}] = await Promise.all([
    db.proposerSlashing.values({limit: config.params.MAX_PROPOSER_SLASHINGS}),
    db.attesterSlashing.values({limit: config.params.MAX_ATTESTER_SLASHINGS}),
    db.aggregateAndProof
      .getBlockAttestations(currentState)
      .then((value) => value.slice(0, config.params.MAX_ATTESTATIONS)),
    db.voluntaryExit.values({limit: config.params.MAX_VOLUNTARY_EXITS}),
    eth1.getEth1DataAndDeposits(currentState),
  ]);

  return {
    randaoReveal,
    graffiti,
    eth1Data,
    proposerSlashings: proposerSlashings as List<ProposerSlashing>,
    attesterSlashings: attesterSlashings as List<AttesterSlashing>,
    attestations: attestations as List<Attestation>,
    deposits: deposits as List<Deposit>,
    voluntaryExits: voluntaryExits as List<SignedVoluntaryExit>,
  };
}
