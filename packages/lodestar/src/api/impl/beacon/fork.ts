import {Fork, Uint64, BeaconState} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "../../../db";
import {IBeaconChain} from "../../../chain";


export async function getFork(db: IBeaconDb, chain: IBeaconChain): Promise<{fork: Fork; chainId: Uint64}> {
  const state: BeaconState = await db.state.getLatest();
  const networkId: Uint64 = chain.networkId;
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
