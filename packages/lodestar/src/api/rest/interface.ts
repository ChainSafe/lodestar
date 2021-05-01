import {FastifyInstance, Plugin} from "fastify";
import {IncomingMessage, Server, ServerResponse} from "http";

import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";

import {IApi, IBeaconApi, IValidatorApi} from "../impl";
import {IMetrics} from "../../metrics";

export interface ILodestarApiOpts {
  // path prefix
  prefix: string;
  api: {
    beacon: IBeaconApi;
    validator: IValidatorApi;
  };
  config: IBeaconConfig;
}
export type LodestarApiPlugin = Plugin<Server, IncomingMessage, ServerResponse, ILodestarApiOpts>;
export type LodestarRestApiEndpoint = (server: FastifyInstance, opts: ILodestarApiOpts) => void;

export interface IRestApiModules {
  config: IBeaconConfig;
  logger: ILogger;
  api: IApi;
  metrics: IMetrics | null;
}
