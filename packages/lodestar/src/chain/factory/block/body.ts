/**
 * @module chain/blockAssembly
 */

import {TreeBacked, List} from "@chainsafe/ssz";
import {BeaconBlockBody, BeaconState, Bytes96, Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ZERO_HASH} from "../../../constants";
import {IBeaconDb} from "../../../db";
import {IEth1Notifier} from "../../../eth1";
import {generateDeposits} from "./deposits";

export async function assembleBody(
  config: IBeaconConfig,
  db: IBeaconDb,
  eth1: IEth1Notifier,
  depositDataRootList: TreeBacked<List<Root>>,
  currentState: BeaconState,
  randao: Bytes96
): Promise<BeaconBlockBody> {
  const [proposerSlashings, attesterSlashings, attestations, voluntaryExits, eth1Data] = await Promise.all([
    db.proposerSlashing.values().then(value => value.slice(0, config.params.MAX_PROPOSER_SLASHINGS)),
    db.attesterSlashing.values().then(value => value.slice(0, config.params.MAX_ATTESTER_SLASHINGS)),
    db.aggregateAndProof.getBlockAttestations(currentState)
      .then(value => value.slice(0, config.params.MAX_ATTESTATIONS)),
    db.voluntaryExit.values().then(value => value.slice(0, config.params.MAX_VOLUNTARY_EXITS)),
    eth1.getEth1Vote(config, currentState)
  ]);
  //requires new eth1 data so it has to be done after above operations
  const deposits = await generateDeposits(config, db, currentState, eth1Data, depositDataRootList);
  eth1Data.depositRoot = depositDataRootList.tree().root;
  return {
    randaoReveal: randao,
    eth1Data: eth1Data,
    graffiti: ZERO_HASH,
    proposerSlashings,
    attesterSlashings,
    attestations,
    deposits,
    voluntaryExits,
  };
}
