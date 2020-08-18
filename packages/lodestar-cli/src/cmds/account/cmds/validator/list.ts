import {ValidatorDirManager} from "../../../../validatorDir";
import {getAccountPaths} from "../../paths";
import {IAccountValidatorArgs} from "./options";
import {ICliCommand} from "../../../../util";
import {IGlobalArgs} from "../../../../options";

export const list: ICliCommand<{}, IAccountValidatorArgs & IGlobalArgs> = {
  command: "list",

  describe: "Lists the public keys of all validators",

  examples: [
    {
      command: "account validator list --keystoresDir .testing/keystores",
      description: "List all validator pubkeys in the directory .testing/keystores",
    },
  ],

  handler: (options) => {
    const accountPaths = getAccountPaths(options);

    const validatorDirManager = new ValidatorDirManager(accountPaths);
    const validatorPubKeys = validatorDirManager.iterDir();

    // eslint-disable-next-line no-console
    console.log(validatorPubKeys.join("\n"));
  },
};
