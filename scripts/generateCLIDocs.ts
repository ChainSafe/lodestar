import { globalOptions } from "../packages/lodestar-cli/src/options";
import { writeFile } from "fs";
import { accountValidatorOptions } from "../packages/lodestar-cli/src/cmds/account/cmds/validator/options";
import { accountWalletsOptions } from "../packages/lodestar-cli/src/cmds/account/cmds/wallet/options";
import { beaconOptions } from "../packages/lodestar-cli/src/cmds/beacon/options";
import { validatorOptions } from "../packages/lodestar-cli/src/cmds/validator/options";
import { validator } from "../packages/lodestar-cli/src/cmds/validator";
import { account } from "../packages/lodestar-cli/src/cmds/account";
import { beacon } from "../packages/lodestar-cli/src/cmds/beacon";
import {init as beaconInit} from "../packages/lodestar-cli/src/cmds/beacon/cmds/init";
import {run as beaconRun} from "../packages/lodestar-cli/src/cmds/beacon/cmds/run";
import {wallet as accountWallet} from "../packages/lodestar-cli/src/cmds/account/cmds/wallet";
import {validator as accountValidator} from "../packages/lodestar-cli/src/cmds/account/cmds/validator";
import { paramsOptions } from "@chainsafe/lodestar-cli/lib/options";

const optionsTableHeader = `| Name | Type | Description |\n| ----------- | ----------- | ----------- |\n`;

let globalOptionsStr = '';
for (const [key, value] of Object.entries(globalOptions)) {
  globalOptionsStr = globalOptionsStr.concat(`| ${key} | ${value.type} | ${value.description} | ${value.default} |\n`);
};

function getOptionsTable(options: object) {
  let optionsStr = optionsTableHeader;
  for(const [key, value] of Object.entries(options)) {
    if (!(key in paramsOptions))
    optionsStr = optionsStr.concat(`| ${key} | ${value.type} | ${value.description} | \n`);
  }
  return optionsStr;
}

function getUsage<T>(commandModules: Array<any>) {
  let usageStr = `### Usage\n| Command | Description |\n| - | - |\n`;
  commandModules.forEach((commandModule) => 
    usageStr = usageStr.concat(`| ${commandModule.command} | ${commandModule.describe} | \n`)
  );
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
${getUsage([account, accountWallet, accountValidator])}
### account validator <command> options
${getOptionsTable(accountValidatorOptions)}
### account wallet <command> options
${getOptionsTable(accountWalletsOptions)}

## Beacon
${getUsage([beacon, beaconInit, beaconRun])}
### Options
${getOptionsTable(beaconOptions)}

## Validator
${getUsage([validator])}
### Options
${getOptionsTable(validatorOptions)}
`;

  writeFile('./docs/usage/cli.md', docsString, () => {});
}

generate();