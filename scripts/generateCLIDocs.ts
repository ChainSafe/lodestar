import { globalOptions } from "../packages/lodestar-cli/src/options";
import { writeFile } from "fs";
import { accountValidatorOptions } from "../packages/lodestar-cli/src/cmds/account/cmds/validator/options";
import { accountWalletsOptions } from "../packages/lodestar-cli/src/cmds/account/cmds/wallet/options";
import { beaconOptions } from "../packages/lodestar-cli/src/cmds/beacon/options";
import { validatorOptions } from "../packages/lodestar-cli/src/cmds/validator/options";
import { validator } from "../packages/lodestar-cli/src/cmds/validator";
import { account } from "../packages/lodestar-cli/src/cmds/account";
import { beacon } from "../packages/lodestar-cli/src/cmds/beacon";
import {init as beaconInit} from "../packages/lodestar-cli/src/cmds/init";
import {beacon as beaconRun} from "../packages/lodestar-cli/src/cmds/beacon";
import {wallet as accountWallet} from "../packages/lodestar-cli/src/cmds/account/cmds/wallet";
import {validator as accountValidator} from "../packages/lodestar-cli/src/cmds/account/cmds/validator";
import { paramsOptions } from "@chainsafe/lodestar-cli/lib/options";
import {builder as accountValidatorCreateOptions} from "../packages/lodestar-cli/src/cmds/account/cmds/validator/create";
import {builder as accountValidatorDepositOptions} from "../packages/lodestar-cli/src/cmds/account/cmds/validator/deposit";
import {builder as accountValidatorImportOptions} from "../packages/lodestar-cli/src/cmds/account/cmds/validator/import";
import {builder as accountValidatorListOptions} from "../packages/lodestar-cli/src/cmds/account/cmds/validator/list";

import {builder as accountWalletCreateOptions} from "../packages/lodestar-cli/src/cmds/account/cmds/wallet/create";
import {builder as accountWalletListOptions} from "../packages/lodestar-cli/src/cmds/account/cmds/wallet/list";

const optionsTableHeader = `| Name | Type | Description |\n| ----------- | ----------- | ----------- |\n`;

let globalOptionsStr = '';
for (const [key, value] of Object.entries(globalOptions)) {
  if (!(key in paramsOptions))
  globalOptionsStr = globalOptionsStr.concat(`| ${key} | ${value.type} | ${value.description} | ${value.default || ''} |\n`);
};

function getOptionsTable(options: object) {
  if (Object.keys(options).length === 0) {
    return "N/A";
  }

  let optionsStr = optionsTableHeader;
  for(const [key, value] of Object.entries(options)) {
    if (!(key in paramsOptions))
    optionsStr = optionsStr.concat(`| ${key} | ${value.type} | ${value.description} | \n`);
  }
  return optionsStr;
}

function getUsage(commandModules: Array<any>, commandName: string) {
  let usageStr = `### Usage\n| Command | Description |\n| - | - |\n`;
  commandModules.forEach((commandModule) => {
    const isChildCommand = (typeof commandModule.command === "string" && !commandModule.command.includes(commandName));
    // prefix with the parent command name (e.g. beacon) if processing a child command (e.g. init, run)
    // const commandStr = isChildCommand ? `${commandName} ${commandModule.command}` : commandModule.command;
    return usageStr = usageStr.concat(`| ${commandModule.command} | ${commandModule.describe} | \n`)
  });
  return usageStr;
}

function generate() {
  let docsString = `
# Lodestar CLI Documentation
This reference describes the syntax of the Lodestar CLI options and commands.


## Global Options

| Name | Type | Description | Default |
| ----------- | ----------- | ----------- | ----------- |
${globalOptionsStr}


## Account
${getUsage([account, accountWallet, accountValidator], 'account')}
### account validator <command> options
${getOptionsTable(accountValidatorOptions)}
#### account validator create options
${getOptionsTable(accountValidatorCreateOptions)}
#### account validator deposit options
${getOptionsTable(accountValidatorDepositOptions)}
#### account validator import options
${getOptionsTable(accountValidatorImportOptions)}
#### account validator list options
${getOptionsTable(accountValidatorListOptions)}

### account wallet <command> options
${getOptionsTable(accountWalletsOptions)}
#### account wallet create options
${getOptionsTable(accountWalletCreateOptions)}
#### account wallet list options
${getOptionsTable(accountWalletListOptions)}

## Beacon
${getUsage([beaconInit, beaconRun], 'beacon')}
### Options
${getOptionsTable(beaconOptions)}


## Validator
${getUsage([validator], 'validator')}
### Options
${getOptionsTable(validatorOptions)}
`;

  writeFile('./docs/usage/cli.md', docsString, () => {});
}

generate();