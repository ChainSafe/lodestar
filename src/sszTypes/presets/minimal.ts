/**
 * @module sszTypes/presets/minimal
 */
import * as params from "../../params/presets/minimal";
import {createIBeaconSSZTypes} from "../generators";
import {IBeaconSSZTypes} from "../interface";

export const types: IBeaconSSZTypes = createIBeaconSSZTypes(params);
