import {defaultAccountPaths} from "../../paths.js";
import {ICliCommandOptions} from "../../../../util/index.js";

export interface IAccountWalletArgs {
  walletsDir?: string;
}

export const accountWalletsOptions: ICliCommandOptions<IAccountWalletArgs> = {
  walletsDir: {
    description: "Directory for storing wallets.",
    defaultDescription: defaultAccountPaths.walletsDir,
    type: "string",
  },
};
