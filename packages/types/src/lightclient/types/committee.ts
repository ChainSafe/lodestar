import {Vector} from "@chainsafe/ssz";

import * as phase0 from "../../phase0";

export interface SyncCommittee {
  pubkeys: Vector<phase0.BLSPubkey>;
  pubkeyAggregates: Vector<phase0.BLSPubkey>;
}
