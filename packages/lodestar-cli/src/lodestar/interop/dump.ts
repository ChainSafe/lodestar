import fs from "fs";
import {serialize} from "@chainsafe/ssz";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";

import {quickStartState} from "./state";
import {DEPOSIT_CONTRACT_TREE_DEPTH} from "@chainsafe/lodestar/lib/constants";

import yargs from "yargs";
import {ProgressiveMerkleTree} from "@chainsafe/eth2.0-utils";

import {MerkleTreeSerialization} from "@chainsafe/lodestar/lib/util/serialization";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
const args = yargs.parse()._;

// This file runs the dump command:
// node -r ts-node/register src/interop/dump.ts genesisTime validatorCount outputFile

export function dumpQuickStartState(
  config: IBeaconConfig,
  genesisTime: number,
  validatorCount: number,
  output: string,
): void {
  const tree = ProgressiveMerkleTree.empty(DEPOSIT_CONTRACT_TREE_DEPTH, new MerkleTreeSerialization(config));
  const state = quickStartState(config, tree, genesisTime, validatorCount);
  const BeaconState = config.types.BeaconState;
  fs.writeFileSync(output, serialize(BeaconState, state));
}

dumpQuickStartState(config, parseInt(args[0]), parseInt(args[1]), args[2]);
