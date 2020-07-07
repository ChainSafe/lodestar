import {CommandBuilder} from "yargs";
import {IGlobalArgs} from "../../options";
import {IChainArgs} from "../dev/options/chain";
import {defaultPaths, IAccountPaths} from "./paths";

export interface IValidatorCliOptions extends IGlobalArgs, IAccountPaths, IChainArgs {
  server: string;
}

export const validatorOptions: CommandBuilder<{}, IValidatorCliOptions> = {
  walletsDir: {
    description: `A path containing Eth2 EIP-2386 wallets.\n[default: ${defaultPaths.walletsDir}]`
  },

  keystoresDir: {
    description: `The directory for storing validator keystores.\n[default: ${defaultPaths.keystoresDir}]`,
    normalize: true,
    type: "string",
  },

  secretsDir: {
    description: `The directory for storing validator keystore secrets.\n[default: ${defaultPaths.secretsDir}]`,
    normalize: true,
    type: "string",
  },
};

