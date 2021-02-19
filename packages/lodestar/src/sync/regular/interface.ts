import {ISyncModule, ISyncModules} from "../index";
import {EventEmitter} from "events";
import StrictEventEmitter from "strict-event-emitter-types";

export interface IRegularSyncEvents {
  syncCompleted: () => void;
}

export type RegularSyncEventEmitter = StrictEventEmitter<EventEmitter, IRegularSyncEvents>;

export type IRegularSync = ISyncModule &
  RegularSyncEventEmitter & {
    start(): void;
    stop(): void;
  };

export type IRegularSyncModules = Pick<ISyncModules, "config" | "chain" | "network" | "logger">;
