import {devRunOptions} from "./options";
import {run} from "./run";

export const command = "dev";

export const description = "Command used to quickly bootstrap beacon node and validators";

export const builder = devRunOptions;

export const handler = run;
