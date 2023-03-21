import {ssz} from "@lodestar/types";
import {CachedBeaconStateAllForks} from "@lodestar/state-transition";
import {CompositeViewDU, VectorCompositeType} from "@chainsafe/ssz";
import {Eth1Block} from "../../eth1/interface.js";

export type GenesisResult = {
  state: CachedBeaconStateAllForks;
  depositTree: CompositeViewDU<VectorCompositeType<typeof ssz.Root>>;
  block: Eth1Block;
};

export interface IGenesisBuilder {
  waitForGenesis: () => Promise<GenesisResult>;
}
