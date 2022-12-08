import {BeaconPreset} from "../../interface/index.js";
import {phase0} from "./phase0.js";
import {altair} from "./altair.js";
import {bellatrix} from "./bellatrix.js";
import {capella} from "./capella.js";
import {eip4844} from "./eip4844.js";

export const commit = "v1.3.0-alpha.1";

export const preset: BeaconPreset = {
  ...phase0,
  ...altair,
  ...bellatrix,
  ...capella,
  ...eip4844,
};
