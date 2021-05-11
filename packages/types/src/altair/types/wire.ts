import {BitVector} from "@chainsafe/ssz";
import {AttestationSubnets} from "../../phase0/types/misc";
import {Uint64} from "../../primitive/types";

export type SyncSubnets = BitVector;

export interface Metadata {
  seqNumber: Uint64;
  attnets: AttestationSubnets;
  syncnets: SyncSubnets;
}
