import {BeaconPreset} from "../../interface";
import {phase0} from "./phase0";
import {altair} from "./altair";
import {bellatrix} from "./bellatrix";

export const commit = "v1.1.9";

export const preset: BeaconPreset = {
  ...phase0,
  ...altair,
  ...bellatrix,
};
