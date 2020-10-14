import {IService} from "../../node";
import {ISyncCheckpoint, ISyncModule, ISyncModules} from "../index";
import {EventEmitter} from "events";
import StrictEventEmitter from "strict-event-emitter-types";

export interface IRegularSyncEvents {
  syncCompleted: () => void;
}

export type RegularSyncEventEmitter = StrictEventEmitter<EventEmitter, IRegularSyncEvents>;

export type IRegularSync = IService &
  ISyncModule &
  RegularSyncEventEmitter & {
    setLastProcessedBlock(lastProcessedBlock: ISyncCheckpoint): void;
  };

export type IRegularSyncModules = Pick<ISyncModules, "config" | "chain" | "network" | "logger">;
