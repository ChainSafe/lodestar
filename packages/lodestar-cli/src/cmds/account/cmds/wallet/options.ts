import {Options} from "yargs";
import {IGlobalArgs} from "../../../../options";
import {defaultPaths} from "../../paths";

export interface IAccountWalletOptions extends IGlobalArgs {
  walletsDir?: string;
}

export const accountWalletsOptions: {[key: string]: Options} = {
  walletsDir: {
    description: `The directory for storing wallets.\n[default: ${defaultPaths.walletsDir}]`,
    normalize: true,
    type: "string",
  }
};
