/**
 * @module sszTypes/presets/mainnet
 */
import * as params from "../../params/presets/mainnet";
import {createIBeaconSSZTypes} from "../generators";
import {IBeaconSSZTypes} from "../interface";

export const types: IBeaconSSZTypes = createIBeaconSSZTypes(params);
