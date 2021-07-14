import {DomainType, Slot} from "@chainsafe/lodestar-types";

export interface ICachedGenesis {
  getDomain(domainType: DomainType, slot: Slot): Buffer;
}
