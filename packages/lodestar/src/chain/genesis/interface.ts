import {IEth1Provider, IEth1Block} from "../../eth1";
import {ILogger} from "@chainsafe/lodestar-utils";
import {TreeBacked, List} from "@chainsafe/ssz";
import {BeaconState, Root} from "@chainsafe/lodestar-types";

export interface IGenesisBuilderModules {
  eth1Provider: IEth1Provider;
  logger: ILogger;
}

export interface IGenesisResult {
  state: TreeBacked<BeaconState>;
  depositTree: TreeBacked<List<Root>>;
  block: IEth1Block;
}

export interface IGenesisBuilder {
  waitForGenesis: () => Promise<IGenesisResult>;
}
