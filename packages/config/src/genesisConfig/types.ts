import {DomainType, Slot} from "../../../types";

export interface ICachedGenesis {
  getDomain(domainType: DomainType, slot: Slot): Buffer;
}
