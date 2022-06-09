import {ICliCommand, YargsError} from "../../util/index.js";
import {IGlobalArgs} from "../../options/index.js";

const deprecatedDescription = `DEPRECATED

Please use the official tools to perform your deposits
- eth2.0-deposit-cli: https://github.com/ethereum/eth2.0-deposit-cli
- Ethereum Foundation launchpad: https://launchpad.ethereum.org

For commands slashing-protection, voluntary-exit and import, use the validator command:
- validator slashing-protection <command>
- validator voluntary-exit
- validator import
`;

export const account: ICliCommand<Record<never, never>, IGlobalArgs> = {
  // [x..] captures 0 or more positional arguments. This is catch-all to show deprecation notice with any command:
  // $ account
  // $ account validator slashing-protection export
  command: "account [subcommands..]",
  describe: "DEPRECATED",
  handler: async () => {
    throw new YargsError(deprecatedDescription);
  },
};
