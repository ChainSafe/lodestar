import {params} from "@chainsafe/lodestar-params/mainnet";
import {createIBeaconSSZTypes} from "../index";

export const types = createIBeaconSSZTypes(params);
