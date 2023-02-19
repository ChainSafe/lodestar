import {CliCommand} from "../../util/index.js";
import {getBeaconConfigFromArgs} from "../../config/beaconParams.js";
import {GlobalArgs} from "../../options/index.js";
import {IValidatorCliArgs} from "./options.js";
import {getSignerPubkeyHex, getSignersFromArgs} from "./signers/index.js";
import {logSigners} from "./signers/logSigners.js";

export type ReturnType = string[];

export const list: CliCommand<IValidatorCliArgs, GlobalArgs, ReturnType> = {
  command: "list",

  describe: "Lists the public keys of all validators",

  examples: [
    {
      command: "validator list",
      description: "List all validator pubkeys previously imported",
    },
  ],

  handler: async (args) => {
    const {network} = getBeaconConfigFromArgs(args);

    const signers = await getSignersFromArgs(args, network, {logger: console, signal: new AbortController().signal});

    logSigners(console, signers);

    // Return values for testing
    return signers.map(getSignerPubkeyHex);
  },
};
