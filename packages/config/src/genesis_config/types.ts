import {ForkName} from "@lodestar/params";
import {DomainType, ForkDigest, Root, Slot} from "@lodestar/types";

export type ForkDigestHex = string;

export type ForkDigestContext = {
  forkDigest2ForkName(forkDigest: ForkDigest | ForkDigestHex): ForkName;
  forkDigest2ForkNameOption(forkDigest: ForkDigest | ForkDigestHex): ForkName | null;
  forkName2ForkDigest(forkName: ForkName): ForkDigest;
  forkName2ForkDigestHex(forkName: ForkName): ForkDigestHex;
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

  readonly genesisValidatorsRoot: Root;
}
