import {BeaconPreset} from "../../interface/index.js";
import {phase0} from "./phase0.js";
import {altair} from "./altair.js";
import {bellatrix} from "./bellatrix.js";
import {capella} from "./capella.js";

export const commit = "v1.2.0";

export const preset: BeaconPreset = {
  ...phase0,
  ...altair,
  ...bellatrix,
  ...capella,
};
