/**
 * @module chain/blockAssembly
 */

import {hashTreeRoot} from "@chainsafe/ssz";
import {BeaconState, Deposit, Eth1Data} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {OpPool} from "../../../opPool";
import {IProgressiveMerkleTree} from "../../../util/merkleTree";
import {processSortedDeposits} from "../../../util/deposits";

export async function generateDeposits(
  config: IBeaconConfig,
  opPool: OpPool,
  state: BeaconState,
  eth1Data: Eth1Data,
  merkleTree: IProgressiveMerkleTree): Promise<Deposit[]> {
  if(eth1Data.depositCount > state.eth1DepositIndex) {
    //TODO: fetch only required
    let deposits = await opPool.deposits.getAll();
    //add all deposits to the tree before getting proof
    return processSortedDeposits(
      config,
      deposits,
      state.eth1DepositIndex,
      eth1Data.depositCount,
      (deposit, index) => {
        merkleTree.add(index + state.eth1DepositIndex, hashTreeRoot(deposit.data, config.types.DepositData));
        return deposit;
      }
    ).map((deposit, index) => {
      deposit.proof = merkleTree.getProof(index + state.eth1DepositIndex);
      return deposit;
    });
  }
  return [];
}
