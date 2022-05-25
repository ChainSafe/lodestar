import {phase0} from "./phase0.js";
import {altair} from "./altair.js";
import {bellatrix} from "./bellatrix.js";
import {BeaconPreset} from "../../interface/index.js";

export const commit = "v1.1.9";

export const preset: BeaconPreset = {
  ...phase0,
  ...altair,
  ...bellatrix,
};
