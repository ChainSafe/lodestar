import {beaconBlocksRoutes} from "./blocks";
import {beaconStateRoutes} from "./state";
import {beaconPoolRoutes} from "./pool";
import {getGenesis} from "./getGenesis";

export const beaconRoutes = [
  //
  ...beaconBlocksRoutes,
  ...beaconStateRoutes,
  ...beaconPoolRoutes,
  getGenesis,
];
