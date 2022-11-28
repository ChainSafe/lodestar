import {phase0, SyncPeriod} from "@lodestar/types";

export enum LightclientEvent {
  /**
   * New head
   */
  head = "head",
  /**
   * New finalized
   */
  finalized = "finalized",
  /**
   * Stored nextSyncCommittee from an update at period `period`.
   * Note: the SyncCommittee is stored for `period + 1`.
   */
  committee = "committee",
  /** New or better optimistic header update available */
  lightClientOptimisticUpdate = "light_client_optimistic_update",
  /** New or better finality update available */
  lightClientFinalityUpdate = "light_client_finality_update",
}

export type LightclientEmitterEvents = {
  [LightclientEvent.head]: (newHeader: phase0.BeaconBlockHeader) => void;
  [LightclientEvent.finalized]: (newHeader: phase0.BeaconBlockHeader) => void;
  [LightclientEvent.committee]: (updatePeriod: SyncPeriod) => void;
};

export type LightclientEmitter = MittEmitter<LightclientEmitterEvents>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MittEmitter<T extends Record<string, (...args: any[]) => void>> = {
  on<K extends keyof T>(type: K, handler: T[K]): void;
  off<K extends keyof T>(type: K, handler: T[K]): void;
  emit<K extends keyof T>(type: K, ...args: Parameters<T[K]>): void;
};
