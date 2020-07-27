import {Options} from "yargs";
import {IGlobalArgs} from "../../../../options";
import {defaultAccountPaths} from "../../paths";

export interface IAccountWalletOptions extends IGlobalArgs {
  walletsDir?: string;
}

export const accountWalletsOptions = {
  walletsDir: {
    description: "Directory for storing wallets.",
    defaultDescription: defaultAccountPaths.walletsDir,
    normalize: true,
    type: "string",
  } as Options
};
