/**
 * @module chain/blockAssembly
 */

import {hashTreeRoot} from "@chainsafe/ssz";
import {BeaconState, Deposit, DepositData, Eth1Data} from "../../../types";
import {MAX_DEPOSITS} from "../../../constants";
import {OpPool} from "../../../opPool";
import {IProgressiveMerkleTree} from "../../../util/merkleTree";
import {processSortedDeposits} from "../../../util/deposits";

export async function generateDeposits(
  opPool: OpPool,
  state: BeaconState,
  eth1Data: Eth1Data,
  merkleTree: IProgressiveMerkleTree): Promise<Deposit[]> {
  if(eth1Data.depositCount > state.depositIndex) {
    //TODO: fetch only required
    let deposits = await opPool.deposits.getAll();
    //add all deposits to the tree before getting proof
    return processSortedDeposits(
      deposits,
      state.depositIndex,
      eth1Data.depositCount,
      (deposit, index) => {
        merkleTree.add(index + state.depositIndex, hashTreeRoot(deposit.data, DepositData));
        return deposit;
      }
    ).map((deposit, index) => {
      deposit.proof = merkleTree.getProof(index + state.depositIndex);
      return deposit;
    });
  }
  return [];
}
