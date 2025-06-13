import {ForkName} from "@lodestar/params";
import {DomainType, Epoch, ForkDigest, Root, Slot} from "@lodestar/types";
import {BlobScheduleEntry} from "../chainConfig/types.js";

export type ForkDigestHex = string;

// TODO: Simplify this api to accept and return SubscribeBoundary
export type ForkDigestContext = {
  forkDigest2ForkName(forkDigest: ForkDigest | ForkDigestHex): ForkName;
  forkDigest2Epoch(forkDigest: ForkDigest | ForkDigestHex): Epoch;
  forkDigest2ForkNameOption(forkDigest: ForkDigest | ForkDigestHex): ForkName | null;
  forkName2ForkDigest(forkName: ForkName, blobSchedule: BlobScheduleEntry): ForkDigest;
  forkName2ForkDigestHex(forkName: ForkName, blobSchedule: BlobScheduleEntry): ForkDigestHex;
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
