import {BeaconPreset} from "../../interface/index.js";
import {phase0} from "./phase0.js";
import {altair} from "./altair.js";
import {bellatrix} from "./bellatrix.js";

export const commit = "v1.2.0-rc.3";

export const preset: BeaconPreset = {
  ...phase0,
  ...altair,
  ...bellatrix,
};
