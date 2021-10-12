import {phase0, SyncPeriod} from "@chainsafe/lodestar-types";

export enum LightclientEvent {
  newHeader = "newHeader",
  advancedCommittee = "advancedCommittee",
}

export type LightclientEvents = {
  [LightclientEvent.newHeader]: (newHeader: phase0.BeaconBlockHeader) => void;
  [LightclientEvent.advancedCommittee]: (newSnapshotPeriod: SyncPeriod) => void;
};

export type LightclientEmitter = MittEmitter<LightclientEvents>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MittEmitter<T extends Record<string, (...args: any[]) => void>> = {
  on<K extends keyof T>(type: K, handler: T[K]): void;
  off<K extends keyof T>(type: K, handler: T[K]): void;
  emit<K extends keyof T>(type: K, ...args: Parameters<T[K]>): void;
};
