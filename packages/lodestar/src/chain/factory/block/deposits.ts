/**
 * @module chain/blockAssembly
 */

import {List, TreeBacked} from "@chainsafe/ssz";
import {BeaconState, Deposit, Eth1Data, DepositData, Root} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {OpPool} from "../../../opPool";

export async function generateDeposits(
  config: IBeaconConfig,
  opPool: OpPool,
  state: BeaconState,
  eth1Data: Eth1Data,
  depositDataRootList: TreeBacked<List<Root>>): Promise<Deposit[]> {
  if(eth1Data.depositCount > state.eth1DepositIndex) {
    const eth1DepositIndex = state.eth1DepositIndex;
    const upperIndex = eth1DepositIndex + Math.min(config.params.MAX_DEPOSITS, eth1Data.depositCount);
    const depositDatas = await opPool.depositData.getAllBetween(
      eth1DepositIndex,
      upperIndex
    );
    //add all deposits to the tree before getting proof
    depositDataRootList.push(...depositDatas.map((data) => config.types.DepositData.hashTreeRoot(data)));
    const tree = depositDataRootList.backing();
    return depositDatas.map((data, index) => {
      return {
        proof: tree.getSingleProof(depositDataRootList.gindexOfProperty(index + eth1DepositIndex)),
        data,
      };
    });
  }
  return [];
}
