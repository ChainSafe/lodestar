import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {BeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {phase0, ssz} from "@chainsafe/lodestar-types";
import {interopDeposits} from "./interop/deposits.js";
import {getInteropState, InteropStateOpts} from "./interop/state.js";
import {IBeaconDb} from "../../db/index.js";
import {GENESIS_SLOT} from "../../constants/index.js";

export async function initDevState(
  config: IChainForkConfig,
  db: IBeaconDb,
  validatorCount: number,
  interopStateOpts: InteropStateOpts
): Promise<BeaconStateAllForks> {
  const deposits = interopDeposits(config, ssz.phase0.DepositDataRootList.defaultViewDU(), validatorCount);
  await storeDeposits(db, deposits);
  const state = getInteropState(
    config,
    interopStateOpts,
    deposits,
    await db.depositDataRoot.getDepositRootTreeAtIndex(validatorCount - 1)
  );
  const block = config.getForkTypes(GENESIS_SLOT).SignedBeaconBlock.defaultValue();
  block.message.stateRoot = state.hashTreeRoot();
  await db.blockArchive.add(block);
  return state;
}

async function storeDeposits(db: IBeaconDb, deposits: phase0.Deposit[]): Promise<void> {
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
