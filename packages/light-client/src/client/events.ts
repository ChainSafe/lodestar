import {phase0, SyncPeriod} from "@chainsafe/lodestar-types";

export enum LightclientEvent {
  /**
   * New head
   */
  head = "head",
  /**
   * New committee at period
   */
  committee = "committee",
}

export type LightclientEvents = {
  [LightclientEvent.head]: (newHeader: phase0.BeaconBlockHeader) => void;
  [LightclientEvent.committee]: (committeePeriod: SyncPeriod) => void;
};

export type LightclientEmitter = MittEmitter<LightclientEvents>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MittEmitter<T extends Record<string, (...args: any[]) => void>> = {
  on<K extends keyof T>(type: K, handler: T[K]): void;
  off<K extends keyof T>(type: K, handler: T[K]): void;
  emit<K extends keyof T>(type: K, ...args: Parameters<T[K]>): void;
};
