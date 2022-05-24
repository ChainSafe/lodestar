import {ValidatorDirManager} from "../../../../validatorDir/index.js";
import {getAccountPaths} from "../../paths.js";
import {IAccountValidatorArgs} from "./options.js";
import {ICliCommand} from "../../../../util/index.js";
import {IGlobalArgs} from "../../../../options/index.js";
import {add0xPrefix} from "../../../../util/format.js";

export type ReturnType = string[];

export const list: ICliCommand<Record<never, never>, IAccountValidatorArgs & IGlobalArgs, ReturnType> = {
  command: "list",

  describe: "Lists the public keys of all validators",

  examples: [
    {
      command: "account validator list --keystoresDir .testing/keystores",
      description: "List all validator pubkeys in the directory .testing/keystores",
    },
  ],

  handler: async (args) => {
    const accountPaths = getAccountPaths(args);

    const validatorDirManager = new ValidatorDirManager(accountPaths);
    const validatorPubKeys = validatorDirManager.iterDir();

    // eslint-disable-next-line no-console
    console.log(validatorPubKeys.map(add0xPrefix).join("\n"));

    // Return values for testing
    return validatorPubKeys;
  },
};
