/**
 * @module chain/blockAssembly
 */

import {BeaconState, Deposit} from "../../types";
import {OpPool} from "../../opPool";

export async function blockDeposits(opPool: OpPool, state: BeaconState): Promise<Deposit[]> {
  if(state.latestEth1Data.depositCount > state.depositIndex) {
    //TODO: get pending deposits (starting with state.depositIndex) and return to be included in block
  }
  return [];
}
