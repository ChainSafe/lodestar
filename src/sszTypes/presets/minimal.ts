/**
 * @module sszTypes/presets/minimal
 */
import * as params from "../../params/presets/minimal";
import {createBeaconSSZTypes} from "../generators";
import {BeaconSSZTypes} from "../interface";

export const types: BeaconSSZTypes = createBeaconSSZTypes(params);
