import {FastifyInstance, Plugin} from "fastify";
import {IncomingMessage, Server, ServerResponse} from "http";
import {IBeaconApi} from "../impl/beacon";
import {IValidatorApi} from "../impl/validator";
import {IBeaconConfig} from "@chainsafe/lodestar-config";

export interface ILodestarApiOpts {
  prefix: string;
  api: {
    beacon: IBeaconApi;
    validator: IValidatorApi;
  };
  config: IBeaconConfig;
}
export type LodestarApiPlugin = Plugin<Server, IncomingMessage, ServerResponse, ILodestarApiOpts>;
export type LodestarRestApiEndpoint = (server: FastifyInstance, opts: ILodestarApiOpts) => void;