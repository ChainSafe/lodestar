import {TreeBacked, List} from "@chainsafe/ssz";
import {allForks, phase0, Root} from "@chainsafe/lodestar-types";

export interface IGenesisResult {
  state: TreeBacked<allForks.BeaconState>;
  depositTree: TreeBacked<List<Root>>;
  block: phase0.Eth1Block;
}

export interface IGenesisBuilder {
  waitForGenesis: () => Promise<IGenesisResult>;
}
