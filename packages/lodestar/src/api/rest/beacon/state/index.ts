import {getEpochCommittees} from "./getEpochCommittees";
import {getStateFinalityCheckpoints} from "./getStateFinalityCheckpoints";
import {getStateFork} from "./getStateFork";
import {getStateRoot} from "./getStateRoot";
import {getStateValidator} from "./getStateValidator";
import {getStateValidators} from "./getStateValidators";
import {getStateValidatorsBalances} from "./getStateValidatorBalances";

export const beaconStateRoutes = [
  getEpochCommittees,
  getStateFinalityCheckpoints,
  getStateFork,
  getStateRoot,
  getStateValidator,
  getStateValidators,
  getStateValidatorsBalances,
];
