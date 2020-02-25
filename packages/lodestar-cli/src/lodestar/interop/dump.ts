import fs from "fs";
import {config} from "@chainsafe/lodestar-config/lib/presets/minimal";

import {quickStartState} from "./state";

import yargs from "yargs";

import {IBeaconConfig} from "@chainsafe/lodestar-config";
const args = yargs.parse()._;

// This file runs the dump command:
// node -r ts-node/register src/interop/dump.ts genesisTime validatorCount outputFile

export function dumpQuickStartState(
  config: IBeaconConfig,
  genesisTime: number,
  validatorCount: number,
  output: string,
): void {
  const depositDataRootList = config.types.DepositDataRootList.tree.defaultValue();
  const state = quickStartState(config, depositDataRootList, genesisTime, validatorCount);
  const BeaconState = config.types.BeaconState;
  fs.writeFileSync(output, BeaconState.serialize(state));
}

dumpQuickStartState(config, parseInt(args[0]), parseInt(args[1]), args[2]);
