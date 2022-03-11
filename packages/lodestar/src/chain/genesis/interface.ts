import {TreeBacked, List} from "@chainsafe/ssz";
import {allForks, Root} from "@chainsafe/lodestar-types";
import {Eth1Block} from "../../eth1/interface";

export interface IGenesisResult {
  state: TreeBacked<allForks.BeaconState>;
  depositTree: TreeBacked<List<Root>>;
  block: Eth1Block;
}

export interface IGenesisBuilder {
  waitForGenesis: () => Promise<IGenesisResult>;
}
