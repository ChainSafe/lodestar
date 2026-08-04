import {defaultOptions} from "@lodestar/builder";
import {CliCommandOptions} from "@lodestar/utils";
import {LogArgs, logOptions} from "../../options/logOptions.js";

export type IBuilderCliArgs = LogArgs & {
  beaconNodeUrl: string;
  keystore: string;
  keystorePassword: string;
  builderPubkey?: string;
};

export const builderOptions: CliCommandOptions<IBuilderCliArgs> = {
  ...logOptions,

  beaconNodeUrl: {
    description: "Url to a trusted beacon node",
    type: "string",
    default: defaultOptions.beaconNodeUrl,
  },

  keystore: {
    description: "Path to a keystore file",
    type: "string",
    demandOption: true,
  },

  keystorePassword: {
    description: "Path to a file with password to decrypt the keystore from 'keystore' option",
    type: "string",
    demandOption: true,
  },

  builderPubkey: {
    description: "Builder's expected public key based on the keystore from 'keystore' option",
    type: "string",
  },
};
