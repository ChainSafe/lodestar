import {IBeaconConfig, IChainForkConfig} from "@chainsafe/lodestar-config";
import {allForks, phase0, ssz} from "@chainsafe/lodestar-types";
import {interopDeposits} from "./interop/deposits";
import {getInteropState, InteropStateOpts} from "./interop/state";
import {mkdirSync, writeFileSync} from "node:fs";
import {dirname} from "node:path";
import {IBeaconDb} from "../../db";
import {TreeBacked} from "@chainsafe/ssz";
import {GENESIS_SLOT} from "../../constants";

export async function initDevState(
  config: IChainForkConfig,
  db: IBeaconDb,
  validatorCount: number,
  interopStateOpts: InteropStateOpts
): Promise<TreeBacked<allForks.BeaconState>> {
  const deposits = interopDeposits(config, ssz.phase0.DepositDataRootList.defaultTreeBacked(), validatorCount);
  await storeDeposits(config, db, deposits);
  const state = getInteropState(
    config,
    interopStateOpts,
    deposits,
    await db.depositDataRoot.getTreeBacked(validatorCount - 1)
  );
  const block = config.getForkTypes(GENESIS_SLOT).SignedBeaconBlock.defaultValue();
  block.message.stateRoot = config.getForkTypes(state.slot).BeaconState.hashTreeRoot(state);
  await db.blockArchive.add(block);
  return state;
}

export function storeSSZState(config: IBeaconConfig, state: TreeBacked<allForks.BeaconState>, path: string): void {
  mkdirSync(dirname(path), {recursive: true});
  writeFileSync(path, config.getForkTypes(state.slot).BeaconState.serialize(state));
}

async function storeDeposits(config: IChainForkConfig, db: IBeaconDb, deposits: phase0.Deposit[]): Promise<void> {
  for (let i = 0; i < deposits.length; i++) {
    await Promise.all([
      db.depositEvent.put(i, {
        blockNumber: i,
        index: i,
        depositData: deposits[i].data,
      }),
      db.depositDataRoot.put(i, ssz.phase0.DepositData.hashTreeRoot(deposits[i].data)),
    ]);
  }
}
