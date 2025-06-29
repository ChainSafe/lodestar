import {ForkName} from "@lodestar/params";
import {DomainType, Epoch, ForkDigest, Root, Slot} from "@lodestar/types";
import {ForkBoundary} from "../forkConfig/types.js";

export type ForkDigestHex = string;

export type ForkDigestContext = {
  forkDigest2ForkBoundary(forkDigest: ForkDigest | ForkDigestHex): ForkBoundary;
  forkDigest2ForkBoundaryOption(forkDigest: ForkDigest | ForkDigestHex): ForkBoundary | null;
  epoch2ForkDigest(epoch: Epoch): ForkDigest;
  epoch2ForkDigestHex(epoch: Epoch): ForkDigestHex;
};

export interface CachedGenesis extends ForkDigestContext {
  /**
   * Return the signature domain (fork version concatenated with domain type) of a message.
   *
   * Note: The configured fork schedule is always used rather than on-chain fork schedule.
   */
  getDomain(stateSlot: Slot, domainType: DomainType, messageSlot?: Slot): Uint8Array;
  /**
   * Return the signature domain corresponding to a particular fork version
   */
  getDomainAtFork(forkName: ForkName, domainType: DomainType): Uint8Array;

  getDomainForVoluntaryExit(stateSlot: Slot, messageSlot?: Slot): Uint8Array;

  readonly genesisValidatorsRoot: Root;
}
