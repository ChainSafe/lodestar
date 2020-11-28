import {config} from "@chainsafe/lodestar-config/lib/presets/mainnet";
import {BeaconState, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {WinstonLogger} from "@chainsafe/lodestar-utils";
import {TreeBacked} from "@chainsafe/ssz";
import * as fs from "fs";

let archivedState: TreeBacked<BeaconState> | null = null;
let signedBlock: TreeBacked<SignedBeaconBlock> | null = null;
const logger = new WinstonLogger();
/**
 * Medalla state with more than 100000 validators.
 */
export async function loadPerformanceState(): Promise<TreeBacked<BeaconState>> {
  if (!archivedState) {
    const binary = await fs.promises.readFile("/Users/tuyennguyen/Downloads/archivedstate_756416");
    const state = config.types.BeaconState.deserialize(binary);
    archivedState = config.types.BeaconState.tree.createValue(state);
    logger.info("Loaded state", {
      slot: archivedState.slot,
      numValidators: archivedState.validators.length,
    });
    // cache roots
    archivedState.hashTreeRoot();
  }
  return archivedState.clone();
}

export async function loadPerformanceBlock(): Promise<TreeBacked<SignedBeaconBlock>> {
  if (!signedBlock) {
    const binary = await fs.promises.readFile("/Users/tuyennguyen/Downloads/archivedblock_756417");
    const type = config.types.SignedBeaconBlock;
    signedBlock = type.tree.createValue(type.deserialize(binary));
    logger.info("Loaded block at slot", signedBlock.message.slot);
  }
  return signedBlock.clone();
}
