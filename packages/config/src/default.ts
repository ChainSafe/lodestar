import {createChainForkConfig} from "./beaconConfig.js";
import {BlobScheduleEntry, defaultChainConfig} from "./chainConfig/index.js";

export const chainConfig = defaultChainConfig;
// for testing purpose only
export const config = createChainForkConfig(defaultChainConfig);
export const defaultBlobSchedule: BlobScheduleEntry = {
  EPOCH: config.ELECTRA_FORK_EPOCH,
  MAX_BLOBS_PER_BLOCK: config.MAX_BLOBS_PER_BLOCK_ELECTRA,
};
