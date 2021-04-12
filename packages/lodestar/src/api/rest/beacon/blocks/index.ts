import {getBlockHeaders} from "./getBlockHeaders";
import {getBlockHeader} from "./getBlockHeader";
import {getBlock} from "./getBlock";
import {getBlockRoot} from "./getBlockRoot";
import {getBlockAttestations} from "./getBlockAttestations";
import {publishBlock} from "./publishBlock";

export const beaconBlocksRoutes = [
  getBlockHeaders,
  getBlockHeader,
  getBlock,
  getBlockRoot,
  getBlockAttestations,
  publishBlock,
];
