import {getStateBeaconCommittees} from "./getBeaconCommittees";
import {getStateFinalityCheckpoints} from "./getStateFinalityCheckpoints";
import {getStateFork} from "./getStateFork";
import {getStateValidator} from "./getValidator";
import {getStateValidators} from "./getValidators";
import {getStateValidatorsBalances} from "./getValidatorsBalances";

export const beaconStateRoutes = [
  getStateBeaconCommittees,
  getStateFinalityCheckpoints,
  getStateFork,
  getStateValidator,
  getStateValidators,
  getStateValidatorsBalances,
];
