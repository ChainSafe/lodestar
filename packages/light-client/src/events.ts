import {Emitter as MittEmitter} from "mitt";
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
