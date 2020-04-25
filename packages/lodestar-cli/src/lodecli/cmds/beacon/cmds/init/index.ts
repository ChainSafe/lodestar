import {IBeaconArgs} from "../../options";

import {init} from "./init";

export const command = "init";

export const description = "Initialize lodestar beacon node";

export const builder = {};

export const handler = init;
