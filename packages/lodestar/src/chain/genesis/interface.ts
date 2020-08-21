import {IBeaconDb} from "../../db";
import {IEth1Provider} from "../../eth1";
import {ILogger} from "@chainsafe/lodestar-utils";
import {TreeBacked} from "@chainsafe/ssz";
import {BeaconState} from "@chainsafe/lodestar-types";

export interface IGenesisBuilderModules {
  db: IBeaconDb;
  eth1Provider: IEth1Provider;
  logger: ILogger;
}

export interface IGenesisBuilder {
  waitForGenesis: () => Promise<TreeBacked<BeaconState>>;
}
