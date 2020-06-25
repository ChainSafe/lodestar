import {Options} from "yargs";

export const beaconApiUrl: Options = {
  alias: [
    "validator.beaconUrl",
  ],
  description: "To delete chain and validator directories. Pass 'memory' for in memory communication",
  type: "string",
  group: "validator",
  default: "http://localhost:9596",
  requiresArg: false
};

export interface IValidatorArgs {
  validator: {
    beaconUrl?: string;
  };
}
