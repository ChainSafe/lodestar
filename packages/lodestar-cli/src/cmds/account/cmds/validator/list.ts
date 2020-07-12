import {CommandBuilder} from "yargs";
import {ValidatorDirManager} from "../../../../validatorDir";
import {getAccountPaths} from "../../paths";
import {IAccountValidatorOptions} from "./options";

export const command = "list";

export const description = "Lists the public keys of all validators";

export const builder: CommandBuilder<{}, IAccountValidatorOptions> = {};

export async function handler(options: IAccountValidatorOptions): Promise<void> {
  const accountPaths = getAccountPaths(options);

  const validatorDirManager = new ValidatorDirManager(accountPaths);
  const validatorPubKeys = validatorDirManager.iterDir();

  // eslint-disable-next-line no-console
  console.log(validatorPubKeys.join("\n"));
}
