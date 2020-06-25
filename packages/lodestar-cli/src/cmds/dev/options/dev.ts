import {Options} from "yargs";

export const genesisValidatorsCount: Options = {
  alias: [
    "dev.genesisValidators",
    "c"
  ],
  description: "If present it will create genesis with interop validators and start chain.",
  type: "number",
  group: "dev",
  requiresArg: false
};

export const startValidators: Options = {
  alias: [
    "dev.startValidators",
    "v"
  ],
  description: "Start interop validators in given range",
  default: "0:8",
  type: "string",
  group: "dev",
  requiresArg: false
};

export const resetChainDir: Options = {
  alias: [
    "dev.reset",
    "r"
  ],
  description: "To delete chain and validator directories",
  type: "boolean",
  group: "dev",
  default: false,
  requiresArg: false
};

export interface IDevArgs {
  dev: {
    genesisValidators?: number;
    startValidators?: string;
    reset?: boolean;
  };
}
