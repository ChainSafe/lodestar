import querystring from "querystring";
import {getLocal, Mockttp} from "mockttp";
import {Proof} from "@chainsafe/persistent-merkle-tree";
import {JsonPath} from "@chainsafe/ssz";
import {Api, routes} from "@lodestar/api";
import {IChainForkConfig} from "@lodestar/config";
import {altair, RootHex, SyncPeriod} from "@lodestar/types";
import {BeaconStateAltair} from "../utils/types.js";

export class LightclientServerApiMock implements routes.lightclient.Api {
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
    for (let period = parseInt(String(from)); period <= parseInt(String(to)); period++) {
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

export async function startServer(opts: ServerOpts, config: IChainForkConfig, apis: Api): Promise<Mockttp> {
  const server = getLocal();

  const lightClientReturnTypes = routes.lightclient.getReturnTypes();
  const eventsReturnTypes = routes.events.getEventSerdes();

  const localRoutes: Record<
    string,
    Record<string, {routeExpr?: RegExp; url: string; method: string; returnType?: {toJson: (data: any) => any}}>
  > = {
    lightclient: {
      getStateProof: {
        ...routes.lightclient.routesData.getStateProof,
        routeExpr: /^\/eth\/v1\/light_client\/proof\/(.*)\//,
        returnType: lightClientReturnTypes.getStateProof,
      },
      getUpdates: {
        ...routes.lightclient.routesData.getUpdates,
        returnType: lightClientReturnTypes.getUpdates,
      },
      getOptimisticUpdate: {
        ...routes.lightclient.routesData.getOptimisticUpdate,
        returnType: lightClientReturnTypes.getOptimisticUpdate,
      },
      getFinalityUpdate: {
        ...routes.lightclient.routesData.getFinalityUpdate,
        returnType: lightClientReturnTypes.getFinalityUpdate,
      },
      getBootstrap: {
        ...routes.lightclient.routesData.getBootstrap,
        routeExpr: /^\/eth\/v1\/light_client\/bootstrap\/(.*)/,
        returnType: lightClientReturnTypes.getBootstrap,
      },
    },
    events: {
      eventstream: {
        ...routes.events.routesData.eventstream,
        returnType: eventsReturnTypes,
      },
    },
  };

  for (const apiKey of Object.keys(localRoutes)) {
    const apiBackend = apis[apiKey as keyof Api];

    for (const apiMethod of Object.keys(localRoutes[apiKey])) {
      const routeOptions = localRoutes[apiKey][apiMethod];

      if (routeOptions.method === "GET") {
        await server.forGet(routeOptions.routeExpr ?? routeOptions.url).thenCallback(async (request) => {
          const match = request.path.match(routeOptions.routeExpr as RegExp);
          const urlParams = match ? [...match].slice(1) : [];
          const queryParams = querystring.parse(request.path.split("?")[1]);
          const methodParams = [...urlParams, ...Object.values(queryParams)];

          // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
          const result = await ((apiBackend[apiMethod as never] as unknown) as (...args: any) => Promise<any>)(
            ...methodParams
          );

          return {json: routeOptions.returnType?.toJson(result) as Record<string, unknown>};
        });
      } else if (routeOptions.method === "POST") {
        throw new Error("No routes are configured for POST method");
      }
    }
  }

  await server.start(opts.port);

  return server;
}
