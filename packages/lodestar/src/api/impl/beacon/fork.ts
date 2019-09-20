import { Fork, uint64, BeaconState } from "@chainsafe/eth2.0-types";
import { IBeaconDb } from "../../../db";
import { IBeaconChain } from "../../../chain";


export async function getFork(db: IBeaconDb, chain: IBeaconChain): Promise<{fork: Fork; chainId: uint64}> {
  const state: BeaconState = await db.state.getLatest();
  const networkId: uint64 = chain.networkId;
  const fork = state? state.fork : {
    previousVersion: Buffer.alloc(4),
    currentVersion: Buffer.alloc(4),
    epoch: 0
  };
  return {
    fork, 
    chainId: networkId
  };
}