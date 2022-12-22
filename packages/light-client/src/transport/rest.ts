import EventEmitter from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import {allForks, altair, SyncPeriod} from "@lodestar/types";
import {Api, routes} from "@lodestar/api";
import {ForkName} from "@lodestar/params";
import {LightClientTransport} from "./interface.js";

export type LightClientRestEvents = {
  [routes.events.EventType.lightClientFinalityUpdate]: altair.LightClientFinalityUpdate;
  [routes.events.EventType.lightClientOptimisticUpdate]: altair.LightClientOptimisticUpdate;
};

type RestEvents = StrictEventEmitter<EventEmitter, LightClientRestEvents>;

export class LightClientRestTransport extends (EventEmitter as {new (): RestEvents}) implements LightClientTransport {
  private controller = new AbortController();
  private readonly eventEmitter: StrictEventEmitter<EventEmitter, LightClientRestEvents> = new EventEmitter();
  private subscribedEventstream = false;

  constructor(private readonly api: Api) {
    super();
  }

  getUpdates(
    startPeriod: SyncPeriod,
    count: number
  ): Promise<
    {
      version: ForkName;
      data: altair.LightClientUpdate;
    }[]
  > {
    return this.api.lightclient.getUpdates(startPeriod, count);
  }

  getOptimisticUpdate(): Promise<{version: ForkName; data: altair.LightClientOptimisticUpdate}> {
    return this.api.lightclient.getOptimisticUpdate();
  }

  getFinalityUpdate(): Promise<{version: ForkName; data: altair.LightClientFinalityUpdate}> {
    return this.api.lightclient.getFinalityUpdate();
  }

  getBootstrap(blockRoot: string): Promise<{version: ForkName; data: altair.LightClientBootstrap}> {
    return this.api.lightclient.getBootstrap(blockRoot);
  }

  fetchBlock(blockRootAsString: string): Promise<{version: ForkName; data: allForks.SignedBeaconBlock}> {
    return this.api.beacon.getBlockV2(blockRootAsString);
  }

  onOptimisticUpdate(handler: (optimisticUpdate: altair.LightClientOptimisticUpdate) => void): void {
    this.subscribeEventstream();
    this.eventEmitter.on(routes.events.EventType.lightClientOptimisticUpdate, handler);
  }

  onFinalityUpdate(handler: (finalityUpdate: altair.LightClientFinalityUpdate) => void): void {
    this.subscribeEventstream();
    this.eventEmitter.on(routes.events.EventType.lightClientFinalityUpdate, handler);
  }

  private subscribeEventstream(): void {
    if (this.subscribedEventstream) {
      return;
    }

    this.api.events.eventstream(
      [routes.events.EventType.lightClientOptimisticUpdate, routes.events.EventType.lightClientFinalityUpdate],
      this.controller.signal,
      (event) => {
        switch (event.type) {
          case routes.events.EventType.lightClientOptimisticUpdate:
            this.eventEmitter.emit(routes.events.EventType.lightClientOptimisticUpdate, event.message);
            break;

          case routes.events.EventType.lightClientFinalityUpdate:
            this.eventEmitter.emit(routes.events.EventType.lightClientFinalityUpdate, event.message);
            break;
        }
      }
    );
  }
}
