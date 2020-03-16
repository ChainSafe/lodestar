import {IDevCommandOptions} from "./command";
import {getTomlConfig} from "../../lodestar/util/file";
import {BeaconNodeOptions} from "../../lodestar/node/options";
import deepmerge from "deepmerge";
import {optionsToConfig} from "../../util";
import {IBeaconNodeOptions} from "@chainsafe/lodestar/lib/node/options";
import PeerId from "peer-id";
import {loadPeerIdFromJsonFile} from "@chainsafe/lodestar/lib/network/nodejs";
import {createPeerId} from "@chainsafe/lodestar/lib/network";
import {BeaconState, Root} from "@chainsafe/lodestar-types";
import {quickStartOptionToState} from "../../lodestar/interop/cli";
import {quickStartState} from "../../lodestar/interop/state";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {List, TreeBacked} from "@chainsafe/ssz";
import {mkdirSync} from "fs";
import rimraf from "rimraf";
import {dirname} from "path";

export function resetPath(path: string): void {
  rimraf.sync(path);
  mkdirSync(dirname(path), {recursive: true});
}


export function getConfig(options: IDevCommandOptions): Partial<IBeaconNodeOptions> {
  let conf: Partial<IBeaconNodeOptions> = {};
  //merge config file
  if (options.configFile) {
    const parsedConfig = getTomlConfig(options.configFile, BeaconNodeOptions);
    //cli will override toml config options
    conf = deepmerge(conf, parsedConfig);
  }

  //override current config with cli config
  conf = deepmerge(conf, optionsToConfig(options, BeaconNodeOptions));
  return conf;
}

export async function getPeerId(peerIdOption = ""): Promise<PeerId> {
  let peerId: PeerId;
  peerId = PeerId.createFromHexString(peerIdOption);
  if(peerId.isValid()) {
    return peerId;
  }
  try {
    peerId = await loadPeerIdFromJsonFile(peerIdOption);
    if(peerId.isValid()) {
      return peerId;
    }
  } catch (e) {
    //ignored
  }
  return await createPeerId();
}

export function getDevGenesisState(
  options: IDevCommandOptions, config: IBeaconConfig, deposits: TreeBacked<List<Root>>
): BeaconState {
  let state: BeaconState;
  if (options.validatorCount) {
    state = quickStartState(
      config,
      deposits,
      parseInt(options.genesisTime),
      parseInt(options.validatorCount)
    );
  } else if (options.genesisState) {
    state = quickStartOptionToState(config, deposits, options.genesisState);
  } else {
    throw new Error("Missing either --genesisState or --validatorCount flag");
  }
  return state;
}