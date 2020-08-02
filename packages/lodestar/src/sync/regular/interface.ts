import {IService} from "../../node";
import {ISyncModule, ISyncModules} from "../index";
import {EventEmitter} from "events";
import StrictEventEmitter from "strict-event-emitter-types";

export interface IRegularSyncEvents {
  findingBestPeer: () => void;
  foundBestPeer: () => void;
}

export type RegularSyncEventEmitter = StrictEventEmitter<EventEmitter, IRegularSyncEvents>;

export type IRegularSync = IService & ISyncModule & RegularSyncEventEmitter;

export type IRegularSyncModules =
    Pick<ISyncModules, "config"|"chain"|"network"|"logger"|"reputationStore">;