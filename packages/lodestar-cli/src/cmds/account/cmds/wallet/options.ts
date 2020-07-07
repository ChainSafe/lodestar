import {Options} from "yargs";
import {IGlobalArgs} from "../../../../options";
import {defaultAccountPaths} from "../../paths";

export interface IAccountWalletOptions extends IGlobalArgs {
  walletsDir?: string;
}

export const accountWalletsOptions = {
  walletsDir: {
    description: `The directory for storing wallets.\n[default: ${defaultAccountPaths.walletsDir}]`,
    normalize: true,
    type: "string",
  } as Options
};
