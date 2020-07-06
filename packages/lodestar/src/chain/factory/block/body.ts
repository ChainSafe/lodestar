/**
 * @module chain/blockAssembly
 */

import {BeaconBlockBody, BeaconState, Bytes96, Bytes32} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

import {IBeaconDb} from "../../../db";
import {generateDeposits} from "./deposits";
import {getEth1Vote} from "./eth1Vote";
import {TreeBacked} from "@chainsafe/ssz";

export async function assembleBody(
  config: IBeaconConfig,
  db: IBeaconDb,
  currentState: TreeBacked<BeaconState>,
  randaoReveal: Bytes96,
  graffiti: Bytes32,
): Promise<BeaconBlockBody> {
  const [
    proposerSlashings,
    attesterSlashings,
    attestations,
    voluntaryExits,
    depositDataRootList,
    eth1Data,
  ] = await Promise.all([
    db.proposerSlashing.values({limit: config.params.MAX_PROPOSER_SLASHINGS}),
    db.attesterSlashing.values({limit: config.params.MAX_ATTESTER_SLASHINGS}),
    db.aggregateAndProof.getBlockAttestations(currentState)
      .then(value => value.slice(0, config.params.MAX_ATTESTATIONS)),
    db.voluntaryExit.values({limit: config.params.MAX_VOLUNTARY_EXITS}),
    db.depositDataRoot.getTreeBacked(currentState.eth1DepositIndex - 1),
    getEth1Vote(config, db, currentState),
  ]);
  //requires new eth1 data so it has to be done after above operations
  const deposits = await generateDeposits(config, db, currentState, eth1Data, depositDataRootList);
  eth1Data.depositRoot = depositDataRootList.tree().root;
  return {
    randaoReveal,
    graffiti,
    eth1Data,
    proposerSlashings,
    attesterSlashings,
    attestations,
    deposits,
    voluntaryExits,
  };
}
