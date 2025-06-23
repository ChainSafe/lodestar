import {ForkName, ForkPostFulu, ForkPreFulu} from "@lodestar/params";
import {DomainType, ForkDigest, Root, Slot} from "@lodestar/types";
import {BlobScheduleEntry} from "../chainConfig/types.js";

export type ForkDigestHex = string;
// Boundary of network subscription. We subscribe/unsubscribe during fork and blob schedule transitions
// TODO: We can actually make `type SubscribeBoundary = Epoch` and rely on the callers to decode it
// as fork or blob schedule as needed. However it takes some sizable refactor give every callers access
// to beacon config
export type SubscribeBoundary = {fork: ForkPreFulu} | ({fork: ForkPostFulu} & BlobScheduleEntry);

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

  getDomainForVoluntaryExit(stateSlot: Slot, messageSlot?: Slot): Uint8Array;

  readonly genesisValidatorsRoot: Root;
}
