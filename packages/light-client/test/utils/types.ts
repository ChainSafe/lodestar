import {CompositeViewDU} from "@chainsafe/ssz";
import {ssz} from "@lodestar/types";

export type BeaconStateAltair = CompositeViewDU<typeof ssz.altair.BeaconState>;
