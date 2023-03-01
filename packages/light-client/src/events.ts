import {allForks} from "@lodestar/types";

export enum LightclientEvent {
  lightClientOptimisticUpdate = "light_client_optimistic_update",
  lightClientFinalityUpdate = "light_client_finality_update",
}

export type LightclientEmitterEvents = {
  [LightclientEvent.lightClientOptimisticUpdate]: (newHeader: allForks.LightClientHeader) => void;
  [LightclientEvent.lightClientFinalityUpdate]: (newHeader: allForks.LightClientHeader) => void;
};

export type LightclientEmitter = MittEmitter<LightclientEmitterEvents>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MittEmitter<T extends Record<string, (...args: any[]) => void>> = {
  on<K extends keyof T>(type: K, handler: T[K]): void;
  off<K extends keyof T>(type: K, handler: T[K]): void;
  emit<K extends keyof T>(type: K, ...args: Parameters<T[K]>): void;
};
