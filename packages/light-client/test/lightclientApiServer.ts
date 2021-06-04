import fastify, {FastifyInstance} from "fastify";
import {Api} from "@chainsafe/lodestar-api";
import {registerRoutes} from "@chainsafe/lodestar-api/server";
import {ILogger} from "@chainsafe/lodestar-utils";
import fastifyCors from "fastify-cors";
import querystring from "querystring";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {LightClientUpdater} from "../src/server/LightClientUpdater";
import {TreeBacked} from "@chainsafe/ssz";
import {altair, ssz} from "@chainsafe/lodestar-types";

/* eslint-disable @typescript-eslint/no-unsafe-member-access */

const maxPeriodsPerRequest = 128;

export type IStateRegen = {
  getStateByRoot(stateRoot: string): Promise<TreeBacked<altair.BeaconState>>;
};

export type ServerOpts = {
  port: number;
  host: string;
};

export type ServerModules = {
  config: IBeaconConfig;
  lightClientUpdater: LightClientUpdater;
  logger: ILogger;
  stateRegen: IStateRegen;
};

export async function startLightclientApiServer(opts: ServerOpts, modules: ServerModules): Promise<FastifyInstance> {
  const server = fastify({
    logger: false,
    ajv: {customOptions: {coerceTypes: "array"}},
    querystringParser: querystring.parse,
  });

  const lightclientApi = getLightclientServerApi(modules);
  registerRoutes(server, modules.config, {lightclient: lightclientApi} as Api, ["lightclient"]);

  void server.register(fastifyCors, {origin: "*"});

  await server.listen(opts.port, opts.host);
  return server;
}

function getLightclientServerApi(modules: ServerModules): Api["lightclient"] {
  const {lightClientUpdater, stateRegen} = modules;

  return {
    async getStateProof(stateId, paths) {
      const state = await stateRegen.getStateByRoot(stateId);
      const tree = ssz.altair.BeaconState.createTreeBackedFromStruct(state);
      return {data: tree.createProof(paths)};
    },

    async getBestUpdates(from, to) {
      const periods = linspace(from, to);
      if (periods.length > maxPeriodsPerRequest) {
        throw Error("Too many periods requested");
      }
      return {data: await lightClientUpdater.getBestUpdates(periods)};
    },

    async getLatestUpdateFinalized() {
      const data = await lightClientUpdater.getLatestUpdateFinalized();
      if (!data) throw Error("No update available");
      return {data};
    },

    async getLatestUpdateNonFinalized() {
      const data = await lightClientUpdater.getLatestUpdateNonFinalized();
      if (!data) throw Error("No update available");
      return {data};
    },
  };
}

function linspace(from: number, to: number): number[] {
  const arr: number[] = [];
  for (let i = from; i <= to; i++) {
    arr.push(i);
  }
  return arr;
}
