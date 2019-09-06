/**
 * @module chain/blockAssembly
 */

import {BeaconBlockBody, BeaconState, bytes96} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {ZERO_HASH} from "../../../constants";
import {OpPool} from "../../../opPool";
import {IEth1Notifier} from "../../../eth1";
import {IProgressiveMerkleTree} from "../../../util/merkleTree";
import {generateDeposits} from "./deposits";
import {computeEpochOfSlot} from "../../stateTransition/util";

export async function assembleBody(
  config: IBeaconConfig,
  opPool: OpPool,
  eth1: IEth1Notifier,
  merkleTree: IProgressiveMerkleTree,
  currentState: BeaconState,
  randao: bytes96
): Promise<BeaconBlockBody> {
  const [proposerSlashings, attesterSlashings, attestations, voluntaryExits, eth1Data] = await Promise.all([
    opPool.proposerSlashings.getAll().then(value => value.slice(0, config.params.MAX_PROPOSER_SLASHINGS)),
    opPool.attesterSlashings.getAll().then(value => value.slice(0, config.params.MAX_ATTESTER_SLASHINGS)),
    opPool.attestations.getAll().then(value => value.slice(0, config.params.MAX_ATTESTATIONS)),
    opPool.voluntaryExits.getAll().then(value => value.slice(0, config.params.MAX_VOLUNTARY_EXITS)),
    eth1.getEth1Data(config, currentState, computeEpochOfSlot(config, currentState.slot))
  ]);
  //requires new eth1 data so it has to be done after above operations
  const deposits = await generateDeposits(config, opPool, currentState, eth1Data, merkleTree);
  eth1Data.depositRoot = merkleTree.root();
  return {
    randaoReveal: randao,
    eth1Data: eth1Data,
    graffiti: ZERO_HASH,
    proposerSlashings,
    attesterSlashings,
    attestations,
    deposits,
    voluntaryExits,
    transfers: [],
  };
}
