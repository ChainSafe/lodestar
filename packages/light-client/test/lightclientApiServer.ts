import querystring from "querystring";
import fastify, {FastifyInstance} from "fastify";
import fastifyCors from "fastify-cors";
import {Api, routes} from "@lodestar/api";
import {registerRoutes} from "@lodestar/api/beacon/server";
import {IChainForkConfig} from "@lodestar/config";
import {JsonPath} from "@chainsafe/ssz";
import {altair, RootHex, SyncPeriod} from "@lodestar/types";
import {Proof} from "@chainsafe/persistent-merkle-tree";
import {BeaconStateAltair} from "./types.js";

/* eslint-disable @typescript-eslint/no-unsafe-member-access */

export type IStateRegen = {
  getStateByRoot(stateRoot: string): Promise<BeaconStateAltair>;
};

export type IBlockCache = {
  getBlockByRoot(blockRoot: string): Promise<altair.BeaconBlock>;
};

export type ServerOpts = {
  port: number;
  host: string;
};

export async function startServer(opts: ServerOpts, config: IChainForkConfig, api: Api): Promise<FastifyInstance> {
  const server = fastify({
    logger: false,
    ajv: {customOptions: {coerceTypes: "array"}},
    querystringParser: querystring.parse,
  });

  registerRoutes(server, config, api, ["lightclient", "events"]);

  void server.register(fastifyCors, {origin: "*"});

  await server.listen(opts.port, opts.host);
  return server;
}

export class LightclientServerApi implements routes.lightclient.Api {
  readonly states = new Map<RootHex, BeaconStateAltair>();
  readonly updates = new Map<SyncPeriod, altair.LightClientUpdate>();
  readonly snapshots = new Map<RootHex, routes.lightclient.LightclientSnapshotWithProof>();
  latestHeadUpdate: routes.lightclient.LightclientOptimisticHeaderUpdate | null = null;
  finalized: routes.lightclient.LightclientFinalizedUpdate | null = null;

  async getStateProof(stateId: string, paths: JsonPath[]): Promise<{data: Proof}> {
    const state = this.states.get(stateId);
    if (!state) throw Error(`stateId ${stateId} not available`);
    return {data: state.createProof(paths)};
  }

  async getUpdates(from: SyncPeriod, to: SyncPeriod): Promise<{data: altair.LightClientUpdate[]}> {
    const updates: altair.LightClientUpdate[] = [];
    for (let period = from; period <= to; period++) {
      const update = this.updates.get(period);
      if (update) {
        updates.push(update);
      }
    }
    return {data: updates};
  }

  async getOptimisticUpdate(): Promise<{data: routes.lightclient.LightclientOptimisticHeaderUpdate}> {
    if (!this.latestHeadUpdate) throw Error("No latest head update");
    return {data: this.latestHeadUpdate};
  }

  async getFinalityUpdate(): Promise<{data: routes.lightclient.LightclientFinalizedUpdate}> {
    if (!this.finalized) throw Error("No finalized head update");
    return {data: this.finalized};
  }

  async getBootstrap(blockRoot: string): Promise<{data: routes.lightclient.LightclientSnapshotWithProof}> {
    const snapshot = this.snapshots.get(blockRoot);
    if (!snapshot) throw Error(`snapshot for blockRoot ${blockRoot} not available`);
    return {data: snapshot};
  }
}

type OnEvent = (event: routes.events.BeaconEvent) => void;

/**
 * In-memory simple event emitter for `BeaconEvent`
 */
export class EventsServerApi implements routes.events.Api {
  private readonly onEventsByTopic = new Map<routes.events.EventType, Set<OnEvent>>();

  hasSubscriptions(): boolean {
    return this.onEventsByTopic.size > 0;
  }

  emit(event: routes.events.BeaconEvent): void {
    const onEvents = this.onEventsByTopic.get(event.type);
    if (onEvents) {
      for (const onEvent of onEvents) {
        onEvent(event);
      }
    }
  }

  eventstream(topics: routes.events.EventType[], signal: AbortSignal, onEvent: OnEvent): void {
    for (const topic of topics) {
      let onEvents = this.onEventsByTopic.get(topic);
      if (!onEvents) {
        onEvents = new Set();
        this.onEventsByTopic.set(topic, onEvents);
      }

      onEvents.add(onEvent);
    }

    signal.addEventListener(
      "abort",
      () => {
        for (const topic of topics) {
          this.onEventsByTopic.get(topic)?.delete(onEvent);
        }
      },
      {once: true}
    );
  }
}
