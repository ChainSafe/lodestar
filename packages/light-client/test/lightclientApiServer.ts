import fastify, {FastifyInstance} from "fastify";
import {Api} from "@chainsafe/lodestar-api";
import {registerRoutes} from "@chainsafe/lodestar-api/server";
import {ILogger} from "@chainsafe/lodestar-utils";
import fastifyCors from "fastify-cors";
import querystring from "querystring";
import {IChainForkConfig} from "@chainsafe/lodestar-config";
import {TreeBacked} from "@chainsafe/ssz";
import {altair, ssz} from "@chainsafe/lodestar-types";
import {blockToHeader} from "@chainsafe/lodestar-beacon-state-transition";
import {LightClientUpdater} from "../src/server/LightClientUpdater";

/* eslint-disable @typescript-eslint/no-unsafe-member-access */

const maxPeriodsPerRequest = 128;

export type IStateRegen = {
  getStateByRoot(stateRoot: string): Promise<TreeBacked<altair.BeaconState>>;
};

export type IBlockCache = {
  getBlockByRoot(blockRoot: string): Promise<altair.BeaconBlock>;
};

export type ServerOpts = {
  port: number;
  host: string;
};

export type ServerModules = {
  config: IChainForkConfig;
  lightClientUpdater: LightClientUpdater;
  logger: ILogger;
  stateRegen: IStateRegen;
  blockCache: IBlockCache;
};

export async function startLightclientApiServer(opts: ServerOpts, modules: ServerModules): Promise<FastifyInstance> {
  const server = fastify({
    logger: false,
    ajv: {customOptions: {coerceTypes: "array"}},
    querystringParser: querystring.parse,
  });

  const lightclientApi = getLightclientServerApi(modules);
  const beaconApi = getBeaconServerApi(modules);
  const api = {
    lightclient: lightclientApi,
    beacon: beaconApi,
  } as Api;

  registerRoutes(server, modules.config, api, ["lightclient", "beacon"]);

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

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async getInitProof(epoch) {
      throw Error("No init proof available");
    },
  };
}

function getBeaconServerApi(modules: ServerModules): Api["beacon"] {
  const {config, blockCache} = modules;
  const api = {
    async getBlockHeader(blockId: string) {
      const block = await blockCache.getBlockByRoot(blockId);

      return {
        data: {
          root: config.getForkTypes(block.slot).BeaconBlock.hashTreeRoot(block),
          canonical: true,
          header: {
            message: blockToHeader(modules.config, block),
            signature: Buffer.alloc(96, 0),
          },
        },
      };
    },
  } as Partial<Api["beacon"]>;

  return api as Api["beacon"];
}

function linspace(from: number, to: number): number[] {
  const arr: number[] = [];
  for (let i = from; i <= to; i++) {
    arr.push(i);
  }
  return arr;
}
