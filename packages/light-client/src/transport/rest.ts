import mitt from "mitt";
import {type allForks, type SyncPeriod} from "@lodestar/types";
import {type Api, ApiError, routes} from "@lodestar/api";
import {type ForkName} from "@lodestar/params";
import {MittEmitter} from "../events.js";
import {type LightClientTransport} from "./interface.js";

export type LightClientRestEvents = {
  [routes.events.EventType.lightClientFinalityUpdate]: (update: allForks.LightClientFinalityUpdate) => void;
  [routes.events.EventType.lightClientOptimisticUpdate]: (update: allForks.LightClientOptimisticUpdate) => void;
};

export type LightClientRestEmitter = MittEmitter<LightClientRestEvents>;

export class LightClientRestTransport implements LightClientTransport {
  private controller = new AbortController();
  private readonly eventEmitter: LightClientRestEmitter = mitt();
  private subscribedEventstream = false;

  constructor(private readonly api: Api) {}

  async getUpdates(
    startPeriod: SyncPeriod,
    count: number
  ): Promise<
    {
      version: ForkName;
      data: allForks.LightClientUpdate;
    }[]
  > {
    const res = await this.api.lightclient.getUpdates(startPeriod, count);
    ApiError.assert(res);
    return res.response;
  }

  async getOptimisticUpdate(): Promise<{version: ForkName; data: allForks.LightClientOptimisticUpdate}> {
    const res = await this.api.lightclient.getOptimisticUpdate();
    ApiError.assert(res);
    return res.response;
  }

  async getFinalityUpdate(): Promise<{version: ForkName; data: allForks.LightClientFinalityUpdate}> {
    const res = await this.api.lightclient.getFinalityUpdate();
    ApiError.assert(res);
    return res.response;
  }

  async getBootstrap(blockRoot: string): Promise<{version: ForkName; data: allForks.LightClientBootstrap}> {
    const res = await this.api.lightclient.getBootstrap(blockRoot);
    ApiError.assert(res);
    return res.response;
  }

  async fetchBlock(blockRootAsString: string): Promise<{version: ForkName; data: allForks.SignedBeaconBlock}> {
    const res = await this.api.beacon.getBlockV2(blockRootAsString);
    ApiError.assert(res);
    return res.response;
  }

  onOptimisticUpdate(handler: (optimisticUpdate: allForks.LightClientOptimisticUpdate) => void): void {
    this.subscribeEventstream();
    this.eventEmitter.on(routes.events.EventType.lightClientOptimisticUpdate, handler);
  }

  onFinalityUpdate(handler: (finalityUpdate: allForks.LightClientFinalityUpdate) => void): void {
    this.subscribeEventstream();
    this.eventEmitter.on(routes.events.EventType.lightClientFinalityUpdate, handler);
  }

  private subscribeEventstream(): void {
    if (this.subscribedEventstream) {
      return;
    }

    void this.api.events.eventstream(
      [routes.events.EventType.lightClientOptimisticUpdate, routes.events.EventType.lightClientFinalityUpdate],
      this.controller.signal,
      (event) => {
        switch (event.type) {
          case routes.events.EventType.lightClientOptimisticUpdate:
            this.eventEmitter.emit(routes.events.EventType.lightClientOptimisticUpdate, event.message.data);
            break;

          case routes.events.EventType.lightClientFinalityUpdate:
            this.eventEmitter.emit(routes.events.EventType.lightClientFinalityUpdate, event.message.data);
            break;
        }
      }
    );
    this.subscribedEventstream = true;
  }
}
