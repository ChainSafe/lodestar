/**
 * @module sszTypes/presets/mainnet
 */
import * as params from "../../params/presets/mainnet";
import {createBeaconSSZTypes} from "../generators";
import {BeaconSSZTypes} from "../interface";

export const types: BeaconSSZTypes = createBeaconSSZTypes(params);
