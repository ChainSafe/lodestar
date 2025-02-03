import {type ApiClient, routes} from "@lodestar/api";
import {type ForkName} from "@lodestar/params";
import {
  LightClientBootstrap,
  LightClientFinalityUpdate,
  LightClientOptimisticUpdate,
  LightClientUpdate,
  type SyncPeriod,
} from "@lodestar/types";
import mitt from "mitt";
import {MittEmitter} from "../events.js";
import {type LightClientTransport} from "./interface.js";

export type LightClientRestEvents = {
  [routes.events.EventType.lightClientFinalityUpdate]: (update: LightClientFinalityUpdate) => void;
  [routes.events.EventType.lightClientOptimisticUpdate]: (update: LightClientOptimisticUpdate) => void;
};

export type LightClientRestEmitter = MittEmitter<LightClientRestEvents>;

export class LightClientRestTransport implements LightClientTransport {
  private controller = new AbortController();
  private readonly eventEmitter: LightClientRestEmitter = mitt();
  private subscribedEventstream = false;

  constructor(private readonly api: ApiClient) {}

  async getUpdates(
    startPeriod: SyncPeriod,
    count: number
  ): Promise<
    {
      version: ForkName;
      data: LightClientUpdate;
    }[]
  > {
    const res = await this.api.lightclient.getLightClientUpdatesByRange({startPeriod, count});
    const updates = res.value();
    const {versions} = res.meta();
    return updates.map((data, i) => ({data, version: versions[i]}));
  }

  async getOptimisticUpdate(): Promise<{version: ForkName; data: LightClientOptimisticUpdate}> {
    const res = await this.api.lightclient.getLightClientOptimisticUpdate();
    return {version: res.meta().version, data: res.value()};
  }

  async getFinalityUpdate(): Promise<{version: ForkName; data: LightClientFinalityUpdate}> {
    const res = await this.api.lightclient.getLightClientFinalityUpdate();
    return {version: res.meta().version, data: res.value()};
  }

  async getBootstrap(blockRoot: string): Promise<{version: ForkName; data: LightClientBootstrap}> {
    const res = await this.api.lightclient.getLightClientBootstrap({blockRoot});
    return {version: res.meta().version, data: res.value()};
  }

  onOptimisticUpdate(handler: (optimisticUpdate: LightClientOptimisticUpdate) => void): void {
    this.subscribeEventstream();
    this.eventEmitter.on(routes.events.EventType.lightClientOptimisticUpdate, handler);
  }

  onFinalityUpdate(handler: (finalityUpdate: LightClientFinalityUpdate) => void): void {
    this.subscribeEventstream();
    this.eventEmitter.on(routes.events.EventType.lightClientFinalityUpdate, handler);
  }

  private subscribeEventstream(): void {
    if (this.subscribedEventstream) {
      return;
    }

    void this.api.events.eventstream({
      topics: [routes.events.EventType.lightClientOptimisticUpdate, routes.events.EventType.lightClientFinalityUpdate],
      signal: this.controller.signal,
      onEvent: (event) => {
        switch (event.type) {
          case routes.events.EventType.lightClientOptimisticUpdate:
            this.eventEmitter.emit(routes.events.EventType.lightClientOptimisticUpdate, event.message.data);
            break;

          case routes.events.EventType.lightClientFinalityUpdate:
            this.eventEmitter.emit(routes.events.EventType.lightClientFinalityUpdate, event.message.data);
            break;
        }
      },
    });
    this.subscribedEventstream = true;
  }
}
