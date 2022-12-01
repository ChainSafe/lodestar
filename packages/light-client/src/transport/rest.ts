import EventEmitter from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import {allForks, altair, SyncPeriod} from "@lodestar/types";
import {Api, routes} from "@lodestar/api";
import {JsonPath} from "@chainsafe/ssz";
import {Proof} from "@chainsafe/persistent-merkle-tree";
import {LightclientEvent} from "../events.js";
import {LightClientTransport} from "./interface.js";

export type LightClientRestEvents = {
  [LightclientEvent.lightClientFinalityUpdate]: altair.LightClientFinalityUpdate;
  [LightclientEvent.lightClientOptimisticUpdate]: altair.LightClientOptimisticUpdate;
};

type RestEvents = StrictEventEmitter<EventEmitter, LightClientRestEvents>;
type StateGetterFn = (stateId: string, jsonPaths: JsonPath[]) => Promise<{data: Proof}>;

export class LightClientRestTransport extends (EventEmitter as {new (): RestEvents}) implements LightClientTransport {
  private api: Api;
  private stateGetterFn: StateGetterFn;
  private controller: AbortController;

  constructor(api: Api, stateGetterFn: StateGetterFn) {
    super();
    this.api = api;
    this.stateGetterFn = stateGetterFn;
    this.controller = new AbortController();
  }
  getStateProof(stateId: string, jsonPaths: JsonPath[]): Promise<{data: Proof}> {
    return this.stateGetterFn(stateId, jsonPaths);
  }
  getUpdates(startPeriod: SyncPeriod, count: number): Promise<{data: altair.LightClientUpdate[]}> {
    return this.api.lightclient.getUpdates(startPeriod, count);
  }

  getOptimisticUpdate(): Promise<{data: altair.LightClientOptimisticUpdate}> {
    return this.api.lightclient.getOptimisticUpdate();
  }

  getFinalityUpdate(): Promise<{data: altair.LightClientFinalityUpdate}> {
    return this.api.lightclient.getFinalityUpdate();
  }

  getBootstrap(blockRoot: string): Promise<{data: altair.LightClientBootstrap}> {
    return this.api.lightclient.getBootstrap(blockRoot);
  }

  fetchBlock(blockRootAsString: string): Promise<{data: allForks.SignedBeaconBlock}> {
    return this.api.beacon.getBlockV2(blockRootAsString);
  }

  onOptimisticUpdate(handler: (optimisticUpdate: altair.LightClientOptimisticUpdate) => void): void {
    const optimisticHandler = (event: routes.events.BeaconEvent): void => {
      handler(event.message as altair.LightClientOptimisticUpdate);
    };
    this.api.events.eventstream(
      [routes.events.EventType.lightClientOptimisticUpdate],
      this.controller.signal,
      optimisticHandler
    );
  }

  onFinalityUpdate(handler: (finalityUpdate: altair.LightClientFinalityUpdate) => void): void {
    const finalityHandler = (event: routes.events.BeaconEvent): void => {
      handler(event.message as altair.LightClientFinalityUpdate);
    };
    this.api.events.eventstream(
      [routes.events.EventType.lightClientFinalityUpdate],
      this.controller.signal,
      finalityHandler
    );
  }
}
