import {Options} from "yargs";
import {IGlobalArgs} from "../../../../options";
import {defaultAccountPaths} from "../../paths";
import {withDefaultValue} from "../../../../util";

export interface IAccountWalletOptions extends IGlobalArgs {
  walletsDir?: string;
}

export const accountWalletsOptions = {
  walletsDir: {
    description: withDefaultValue("Directory for storing wallets.", defaultAccountPaths.walletsDir),
    normalize: true,
    type: "string",
  } as Options
};
