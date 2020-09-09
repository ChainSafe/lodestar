import {IEth1Provider, IEth1Block} from "../../eth1";
import {ILogger} from "@chainsafe/lodestar-utils";
import {TreeBacked, List} from "@chainsafe/ssz";
import {BeaconState, Root} from "@chainsafe/lodestar-types";
import {AbortSignal} from "abort-controller";

export interface IGenesisBuilderKwargs {
  eth1Provider: IEth1Provider;
  logger: ILogger;
  signal?: AbortSignal;
  MAX_BLOCKS_PER_POLL?: number;
}

export interface IGenesisResult {
  state: TreeBacked<BeaconState>;
  depositTree: TreeBacked<List<Root>>;
  block: IEth1Block;
}

export interface IGenesisBuilder {
  waitForGenesis: () => Promise<IGenesisResult>;
}
