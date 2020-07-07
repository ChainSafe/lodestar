import {run} from "./run";
import {validatorOptions} from "./options";

export const command = "validator";

export const description = "Run one or multiple validator clients";

export const builder = validatorOptions;

export const handler = run;
