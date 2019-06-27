/**
 * @module chain/blockAssembly
 */

import {BeaconState, Deposit, DepositData, Eth1Data} from "../../../types";
import {OpPool} from "../../../opPool";
import {IProgressiveMerkleTree} from "../../../util/merkleTree";
import {MAX_DEPOSITS} from "../../../constants";
import {hashTreeRoot} from "@chainsafe/ssz";
import {processSortedDeposits} from "../../../util/deposits";

export async function generateDeposits(
  opPool: OpPool,
  state: BeaconState,
  eth1Data: Eth1Data,
  merkleTree: IProgressiveMerkleTree): Promise<Deposit[]> {
  if(eth1Data.depositCount > state.depositIndex) {
    let deposits = await opPool.getDeposits();
    //add all deposits to the tree before getting proof
    return processSortedDeposits(
      deposits,
      state.depositIndex,
      eth1Data.depositCount,
      (deposit) => {
        merkleTree.add(deposit.index, hashTreeRoot(deposit.data, DepositData));
        return deposit;
      }
    ).map((deposit) => {
      deposit.proof = merkleTree.getProof(deposit.index);
      return deposit;
    });
  }
  return [];
}
