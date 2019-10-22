import BN from "bn.js";
import {BaseCase} from "@chainsafe/eth2.0-spec-test-util";

export interface ShufflingCase extends BaseCase {
  seed: string;
  count: BN;
  shuffled: BN[];
}