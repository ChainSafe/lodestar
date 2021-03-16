import {TreeBacked, List} from "@chainsafe/ssz";
import {phase0, Root} from "@chainsafe/lodestar-types";

export interface IGenesisResult {
  state: TreeBacked<phase0.BeaconState>;
  depositTree: TreeBacked<List<Root>>;
  block: phase0.Eth1Block;
}

export interface IGenesisBuilder {
  waitForGenesis: () => Promise<IGenesisResult>;
}
