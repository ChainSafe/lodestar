import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {BeaconState, Deposit} from "@chainsafe/lodestar-types";
import {BeaconNode} from "@chainsafe/lodestar/lib/node";
import {interopDeposits} from "./interop/deposits";
import {IBeaconDb} from "@chainsafe/lodestar/lib/db/api/beacon/interface";
import {getInteropState} from "./interop/state";

export async function initDevChain(
  node: BeaconNode, validatorCount: number
): Promise<BeaconState> {
  const deposits = interopDeposits(
    node.config,
    node.config.types.DepositDataRootList.tree.defaultValue(),
    validatorCount
  );
  await storeDeposits(node.config, node.db, deposits);
  const state = getInteropState(
    node.config,
    await node.db.depositDataRoot.getTreeBacked(validatorCount - 1),
    Math.floor(Date.now() / 1000),
    deposits
  );
  await node.chain.initializeBeaconChain(state);
  return state;
}

async function storeDeposits(config: IBeaconConfig, db: IBeaconDb, deposits: Deposit[]): Promise<void> {
  for (let i = 0; i < deposits.length; i++) {
    await Promise.all([
      db.depositData.put(i, deposits[i].data),
      db.depositDataRoot.put(i, config.types.DepositData.hashTreeRoot(deposits[i].data)),
    ]);
  }
}

