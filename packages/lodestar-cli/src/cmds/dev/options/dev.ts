import {IYargsOptionsMap} from "../../../util/yargs";

export interface IDevOptions {
  dev: {
    genesisValidators?: number;
    startValidators?: string;
    reset?: boolean;
  };
}

export const devOptions: IYargsOptionsMap = {
  "dev.genesisValidators": {
    description: "If present it will create genesis with interop validators and start chain.",
    type: "number",
    group: "dev",
    requiresArg: false
  },

  "dev.startValidators": {
    description: "Start interop validators in given range",
    default: "0:8",
    type: "string",
    group: "dev",
    requiresArg: false
  },

  "dev.reset": {
    description: "To delete chain and validator directories",
    type: "boolean",
    group: "dev",
    default: false,
    requiresArg: false
  }
};

