import {CliCommandOptions} from "@lodestar/utils";
import {LogArgs, logOptions} from "../../options/logOptions.js";

export type IBuilderCliArgs = LogArgs & {
  keystore: string;
  keystorePassword: string;
  builderPubkey?: string;
};

export const builderOptions: CliCommandOptions<IBuilderCliArgs> = {
  ...logOptions,

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
    description: "Builder's expected pubkey based on the keystore from 'keystore' option",
    type: "string",
  },
};
