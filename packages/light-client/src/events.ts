import {allForks} from "@lodestar/types";
import {RunStatusCode} from "./index.js";

export enum LightclientEvent {
  lightClientOptimisticHeader = "light_client_optimistic_header",
  lightClientFinalityHeader = "light_client_finality_header",
  statusChange = "light_client_status_change",
}

export type LightclientEmitterEvents = {
  [LightclientEvent.lightClientOptimisticHeader]: (newHeader: allForks.LightClientHeader) => void;
  [LightclientEvent.lightClientFinalityHeader]: (newHeader: allForks.LightClientHeader) => void;
  [LightclientEvent.statusChange]: (code: RunStatusCode) => void;
};

export type LightclientEmitter = MittEmitter<LightclientEmitterEvents>;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type MittEmitter<T extends Record<string, (...args: any[]) => void>> = {
  on<K extends keyof T>(type: K, handler: T[K]): void;
  off<K extends keyof T>(type: K, handler: T[K]): void;
  emit<K extends keyof T>(type: K, ...args: Parameters<T[K]>): void;
};
