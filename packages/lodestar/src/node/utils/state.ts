import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {allForks, phase0} from "@chainsafe/lodestar-types";
import {interopDeposits} from "./interop/deposits";
import {getInteropState} from "./interop/state";
import {mkdirSync, writeFileSync} from "fs";
import {dirname} from "path";
import {IBeaconDb} from "../../db";
import {TreeBacked} from "@chainsafe/ssz";

export async function initDevState(
  config: IBeaconConfig,
  db: IBeaconDb,
  validatorCount: number,
  genesisTime?: number
): Promise<TreeBacked<allForks.BeaconState>> {
  const deposits = interopDeposits(config, config.types.phase0.DepositDataRootList.defaultTreeBacked(), validatorCount);
  await storeDeposits(config, db, deposits);
  const state = getInteropState(
    config,
    await db.depositDataRoot.getTreeBacked(validatorCount - 1),
    genesisTime || Math.floor(Date.now() / 1000),
    deposits
  );
  return state;
}

export function storeSSZState(config: IBeaconConfig, state: TreeBacked<allForks.BeaconState>, path: string): void {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, config.getForkTypes(state.slot).BeaconState.serialize(state));
}

async function storeDeposits(config: IBeaconConfig, db: IBeaconDb, deposits: phase0.Deposit[]): Promise<void> {
  for (let i = 0; i < deposits.length; i++) {
    await Promise.all([
      db.depositEvent.put(i, {
        blockNumber: i,
        index: i,
        depositData: deposits[i].data,
      }),
      db.depositDataRoot.put(i, config.types.phase0.DepositData.hashTreeRoot(deposits[i].data)),
    ]);
  }
}
