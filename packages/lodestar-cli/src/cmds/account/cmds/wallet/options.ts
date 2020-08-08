import {defaultAccountPaths} from "../../paths";
import {ICliCommandOptions} from "../../../../util";

export interface IAccountWalletOptions {
  walletsDir?: string;
}

export const accountWalletsOptions: ICliCommandOptions<IAccountWalletOptions> = {
  walletsDir: {
    description: "Directory for storing wallets.",
    defaultDescription: defaultAccountPaths.walletsDir,
    normalize: true,
    type: "string",
  }
};
