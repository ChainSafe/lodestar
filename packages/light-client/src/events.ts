import {phase0, SyncPeriod} from "@chainsafe/lodestar-types";

export enum LightclientEvent {
  /**
   * New head
   */
  head = "head",
  /**
   * Stored nextSyncCommittee from an update at period `period`.
   * Note: the SyncCommittee is stored for `period + 1`.
   */
  committee = "committee",
}

export type LightclientEvents = {
  [LightclientEvent.head]: (newHeader: phase0.BeaconBlockHeader) => void;
  [LightclientEvent.committee]: (updatePeriod: SyncPeriod) => void;
};

export type LightclientEmitter = MittEmitter<LightclientEvents>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MittEmitter<T extends Record<string, (...args: any[]) => void>> = {
  on<K extends keyof T>(type: K, handler: T[K]): void;
  off<K extends keyof T>(type: K, handler: T[K]): void;
  emit<K extends keyof T>(type: K, ...args: Parameters<T[K]>): void;
};
