import EventEmitter from "events";
import StrictEventEmitter from "strict-event-emitter-types";
import {allForks, altair, SyncPeriod} from "@lodestar/types";
import {Api, ApiError, routes} from "@lodestar/api";
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
  private subscribedEventStream = false;

  constructor(private readonly api: Api) {
    super();
  }

  async getUpdates(
    startPeriod: SyncPeriod,
    count: number
  ): Promise<
    {
      version: ForkName;
      data: altair.LightClientUpdate;
    }[]
  > {
    const res = await this.api.lightclient.getUpdates(startPeriod, count);
    ApiError.assert(res);
    return res.response;
  }

  async getOptimisticUpdate(): Promise<{version: ForkName; data: altair.LightClientOptimisticUpdate}> {
    const res = await this.api.lightclient.getOptimisticUpdate();
    ApiError.assert(res);
    return res.response;
  }

  async getFinalityUpdate(): Promise<{version: ForkName; data: altair.LightClientFinalityUpdate}> {
    const res = await this.api.lightclient.getFinalityUpdate();
    ApiError.assert(res);
    return res.response;
  }

  async getBootstrap(blockRoot: string): Promise<{version: ForkName; data: altair.LightClientBootstrap}> {
    const res = await this.api.lightclient.getBootstrap(blockRoot);
    ApiError.assert(res);
    return res.response;
  }

  async fetchBlock(blockRootAsString: string): Promise<{version: ForkName; data: allForks.SignedBeaconBlock}> {
    const res = await this.api.beacon.getBlockV2(blockRootAsString);
    ApiError.assert(res);
    return res.response;
  }

  onOptimisticUpdate(handler: (optimisticUpdate: altair.LightClientOptimisticUpdate) => void): void {
    this.subscribeEventStream();
    this.eventEmitter.on(routes.events.EventType.lightClientOptimisticUpdate, handler);
  }

  onFinalityUpdate(handler: (finalityUpdate: altair.LightClientFinalityUpdate) => void): void {
    this.subscribeEventStream();
    this.eventEmitter.on(routes.events.EventType.lightClientFinalityUpdate, handler);
  }

  private subscribeEventStream(): void {
    if (this.subscribedEventStream) {
      return;
    }

    void this.api.events.eventstream(
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
    this.subscribedEventStream = true;
  }
}
