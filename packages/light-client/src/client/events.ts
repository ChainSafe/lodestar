import {BeaconBlockHeader} from "@chainsafe/lodestar-types/phase0";

export enum LightclientEvent {
  newHeader = "newHeader",
}

export type LightclientEvents = {
  [LightclientEvent.newHeader]: (newHeader: BeaconBlockHeader) => void;
};

export type LightclientEmitter = MittEmitter<LightclientEvents>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MittEmitter<T extends Record<string, (...args: any[]) => void>> = {
  on<K extends keyof T>(type: K, handler: T[K]): void;
  off<K extends keyof T>(type: K, handler: T[K]): void;
  emit<K extends keyof T>(type: K, ...args: Parameters<T[K]>): void;
};
