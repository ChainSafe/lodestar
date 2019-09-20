import { Fork, uint64, BeaconState } from "@chainsafe/eth2.0-types";
import { IBeaconDb } from "../../../db";
import { IBeaconChain } from "../../../chain";


export async function getFork(db: IBeaconDb, chain: IBeaconChain): Promise<{fork: Fork; chainId: uint64}> {
  const state: BeaconState = await db.state.getLatest();
  const networkId: uint64 = await chain.networkId;
  return {
    fork: state.fork, 
    chainId: networkId
  };
}