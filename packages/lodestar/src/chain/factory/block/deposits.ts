/**
 * @module chain/blockAssembly
 */

import {List, TreeBacked} from "@chainsafe/ssz";
import {BeaconState, Deposit, Eth1Data, Root} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {IBeaconDb} from "../../../db";

export async function generateDeposits(
  config: IBeaconConfig,
  db: IBeaconDb,
  state: BeaconState,
  eth1Data: Eth1Data,
  depositDataRootList: TreeBacked<List<Root>>): Promise<Deposit[]> {
  if(eth1Data.depositCount > state.eth1DepositIndex) {
    const eth1DepositIndex = state.eth1DepositIndex;
    const upperIndex = eth1DepositIndex + Math.min(config.params.MAX_DEPOSITS, eth1Data.depositCount);
    const depositDatas = await db.depositData.values({
      gt: eth1DepositIndex,
      lt: upperIndex
    });
    //add all deposits to the tree before getting proof
    depositDataRootList.push(...depositDatas.map((data) => config.types.DepositData.hashTreeRoot(data)));
    const tree = depositDataRootList.tree();
    return depositDatas.map((data, index) => {
      return {
        proof: tree.getSingleProof(depositDataRootList.gindexOfProperty(index + eth1DepositIndex)),
        data,
      };
    });
  }
  return [];
}
