import {ValidatorDirManager} from "../../../../validatorDir";
import {getAccountPaths} from "../../paths";
import {IAccountValidatorOptions} from "./options";
import {ICliCommand} from "../../../../util";
import {IGlobalArgs} from "../../../../options";

export const list: ICliCommand<{}, IAccountValidatorOptions & IGlobalArgs> = {
  command: "list",

  describe: "Lists the public keys of all validators",

  handler: (options) => {
    const accountPaths = getAccountPaths(options);
  
    const validatorDirManager = new ValidatorDirManager(accountPaths);
    const validatorPubKeys = validatorDirManager.iterDir();
  
    // eslint-disable-next-line no-console
    console.log(validatorPubKeys.join("\n"));
  }
};
