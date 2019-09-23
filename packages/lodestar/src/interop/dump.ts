import fs from "fs";
import {serialize} from "@chainsafe/ssz";
import {config} from "@chainsafe/eth2.0-config/lib/presets/minimal";

import {quickStartState} from "./state";
import {ProgressiveMerkleTree} from "../util/merkleTree";
import {DEPOSIT_CONTRACT_TREE_DEPTH} from "../constants";

export function dumpQuickStartState(
  genesisTime: number,
  validatorCount: number,
  output: string,
): void {
  const tree = ProgressiveMerkleTree.empty(DEPOSIT_CONTRACT_TREE_DEPTH);
  const state = quickStartState(config, tree, genesisTime, validatorCount);
  const BeaconState = config.types.BeaconState;
  fs.writeFileSync(output, serialize(state, BeaconState));
}

// eslint-disable-next-line
import yargs from "yargs";
const args = yargs.parse()._;
dumpQuickStartState(parseInt(args[0]), parseInt(args[1]), args[2]);
