/**
 * @module chain/blockAssembly
 */

import {hashTreeRoot} from "@chainsafe/ssz";
import {BeaconState, Deposit, Eth1Data} from "../../../types";
import {IBeaconConfig} from "../../../config";
import {OpPool} from "../../../opPool";
import {IProgressiveMerkleTree} from "../../../util/merkleTree";
import {processSortedDeposits} from "../../../util/deposits";

export async function generateDeposits(
  config: IBeaconConfig,
  opPool: OpPool,
  state: BeaconState,
  eth1Data: Eth1Data,
  merkleTree: IProgressiveMerkleTree): Promise<Deposit[]> {
  if(eth1Data.depositCount > state.depositIndex) {
    let deposits = await opPool.getDeposits();
    //add all deposits to the tree before getting proof
    return processSortedDeposits(
      config,
      deposits,
      state.depositIndex,
      eth1Data.depositCount,
      (deposit, index) => {
        merkleTree.add(index + state.depositIndex, hashTreeRoot(deposit.data, config.types.DepositData));
        return deposit;
      }
    ).map((deposit, index) => {
      deposit.proof = merkleTree.getProof(index + state.depositIndex);
      return deposit;
    });
  }
  return [];
}
