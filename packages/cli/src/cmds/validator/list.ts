import {ICliCommand} from "../../util/index.js";
import {defaultNetwork, IGlobalArgs} from "../../options/index.js";
import {IValidatorCliArgs} from "./options.js";
import {getSignerPubkeyHex, getSignersFromArgs} from "./signers/index.js";
import {logSigners} from "./signers/logSigners.js";

export type ReturnType = string[];

export const list: ICliCommand<IValidatorCliArgs, IGlobalArgs, ReturnType> = {
  command: "list",

  describe: "Lists the public keys of all validators",

  examples: [
    {
      command: "account validator list",
      description: "List all validator pubkeys previously imported",
    },
  ],

  handler: async (args) => {
    const network = args.network ?? defaultNetwork;
    const signers = await getSignersFromArgs(args, network);

    logSigners(console, signers);

    // Return values for testing
    return signers.map(getSignerPubkeyHex);
  },
};
