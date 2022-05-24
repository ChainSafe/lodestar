import {ssz} from "@chainsafe/lodestar-types";
import {CachedBeaconStateAllForks} from "@chainsafe/lodestar-beacon-state-transition";
import {CompositeViewDU, VectorCompositeType} from "@chainsafe/ssz";
import {Eth1Block} from "../../eth1/interface.js";

export interface IGenesisResult {
  state: CachedBeaconStateAllForks;
  depositTree: CompositeViewDU<VectorCompositeType<typeof ssz.Root>>;
  block: Eth1Block;
}

export interface IGenesisBuilder {
  waitForGenesis: () => Promise<IGenesisResult>;
}
