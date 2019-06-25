/**
 * @module chain/blockAssembly
 */

import {OpPool} from "../../../opPool";
import {BeaconBlockBody, BeaconState, bytes96} from "../../../types";
import {
  MAX_ATTESTATIONS,
  MAX_ATTESTER_SLASHINGS,
  MAX_PROPOSER_SLASHINGS,
  MAX_VOLUNTARY_EXITS,
  ZERO_HASH
} from "../../../constants";
import {bestVoteData} from "./eth1Data";
import {IEth1Notifier} from "../../../eth1";

export async function assembleBody(
  opPool: OpPool,
  eth1: IEth1Notifier,
  currentState: BeaconState,
  randao: bytes96
): Promise<BeaconBlockBody> {
  const [proposerSlashings, attesterSlashings, attestations, voluntaryExits, eth1Data] = await Promise.all([
    opPool.getProposerSlashings().then(value => value.slice(0, MAX_PROPOSER_SLASHINGS)),
    opPool.getAttesterSlashings().then(value => value.slice(0, MAX_ATTESTER_SLASHINGS)),
    opPool.getAttestations().then(value => value.slice(0, MAX_ATTESTATIONS)),
    opPool.getVoluntaryExits().then(value => value.slice(0, MAX_VOLUNTARY_EXITS)),
    bestVoteData(currentState, eth1)
  ]);
  return {
    randaoReveal: randao,
    eth1Data: eth1Data,
    graffiti: ZERO_HASH,
    proposerSlashings,
    attesterSlashings,
    attestations,
    deposits: [],
    voluntaryExits,
    transfers: [],
  };
}
