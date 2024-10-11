import {LightClientHeader} from "@lodestar/types";
import {RunStatusCode} from "./index.js";

export enum LightclientEvent {
  lightClientOptimisticHeader = "light_client_optimistic_header",
  lightClientFinalityHeader = "light_client_finality_header",
  statusChange = "light_client_status_change",
}

export type LightclientEmitterEvents = {
  [LightclientEvent.lightClientOptimisticHeader]: (newHeader: LightClientHeader) => void;
  [LightclientEvent.lightClientFinalityHeader]: (newHeader: LightClientHeader) => void;
  [LightclientEvent.statusChange]: (code: RunStatusCode) => void;
};

export type LightclientEmitter = MittEmitter<LightclientEmitterEvents>;

// biome-ignore lint/suspicious/noExplicitAny: <explanation>
export type MittEmitter<T extends Record<string, (...args: any[]) => void>> = {
  on<K extends keyof T>(type: K, handler: T[K]): void;
  off<K extends keyof T>(type: K, handler: T[K]): void;
  emit<K extends keyof T>(type: K, ...args: Parameters<T[K]>): void;
};
