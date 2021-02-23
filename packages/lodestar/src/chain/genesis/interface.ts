import {IEth1Provider} from "../../eth1";
import {ILogger} from "@chainsafe/lodestar-utils";
import {TreeBacked, List} from "@chainsafe/ssz";
import {phase0, Root} from "@chainsafe/lodestar-types";
import {AbortSignal} from "abort-controller";

export interface IGenesisBuilderKwargs {
  eth1Provider: IEth1Provider;
  logger: ILogger;
  signal?: AbortSignal;
  // eslint-disable-next-line @typescript-eslint/naming-convention
  MAX_BLOCKS_PER_POLL?: number;
}

export interface IGenesisResult {
  state: TreeBacked<phase0.BeaconState>;
  depositTree: TreeBacked<List<Root>>;
  block: phase0.Eth1Block;
}

export interface IGenesisBuilder {
  waitForGenesis: () => Promise<IGenesisResult>;
}
