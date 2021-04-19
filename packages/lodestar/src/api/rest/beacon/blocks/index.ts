import {getBlock} from "./getBlock";
import {getBlockAttestations} from "./getBlockAttestations";
import {getBlockHeader} from "./getBlockHeader";
import {getBlockHeaders} from "./getBlockHeaders";
import {getBlockRoot} from "./getBlockRoot";
import {publishBlock} from "./publishBlock";

export const beaconBlocksRoutes = [
  getBlock,
  getBlockAttestations,
  getBlockHeader,
  getBlockHeaders,
  getBlockRoot,
  publishBlock,
];
