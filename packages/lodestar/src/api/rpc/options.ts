/**
 * @module api/rpc
 */

import {IHttpServerOpts, IWsServerOpts, TransportType} from "./transport";
import {ApiNamespace} from "../index";

export interface IRpcOptions {
  ws: IWsServerOpts;
  http: IHttpServerOpts;
  transports: TransportType[];
  api: ApiNamespace[];
}

export default {
  transports: [],
  api: [ApiNamespace.BEACON, ApiNamespace.VALIDATOR],
  http: {
    host: "127.0.0.1",
    port: 9546,
    cors: "*"
  },
  ws: {
    host: "127.0.0.1",
    port: 9547,
  },
};