import {defaultAccountPaths} from "../../paths";
import {ICliCommandOptions} from "../../../../util";

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
