import {YargsError, ICliCommand} from "../../../../util";
import {IAccountValidatorArgs} from "./options";
import {IGlobalArgs} from "../../../../options";

const deprecatedDescription =
  "DEPRECATED. Please use the official tools to perform your deposits \
- eth2.0-deposit-cli: https://github.com/ethereum/eth2.0-deposit-cli \
- Ethereum Foundation launchpad: https://prater.launchpad.ethereum.org";

export const deposit: ICliCommand<Record<never, never>, IAccountValidatorArgs & IGlobalArgs> = {
  command: "deposit",
  describe: deprecatedDescription,
  examples: [],
  options: {},
  handler: async () => {
    throw new YargsError(deprecatedDescription);
  },
};
