/**
 * @module api/rpc
 */

import {IService} from "../../node";
import {IApiConstructor, IApiModules} from "../interface";
import defaultOptions, {IRpcOptions} from "./options";
import {ILogger} from  "@chainsafe/lodestar-utils/lib/logger";
import {IRpcServer, TransportType, WSServer} from "./transport";
import HttpServer from "./transport/http";
import * as jsonRpc from "noice-json-rpc";
import * as apis from "./api";
import deepmerge from "deepmerge";

export * from "./api";

export class JsonRpc implements IService {

  public transports: IRpcServer[] = [];

  private opts: IRpcOptions;

  private logger: ILogger;

  public constructor(opts: Partial<IRpcOptions>, modules: IApiModules) {
    this.opts = deepmerge(defaultOptions, opts);
    this.logger = modules.logger;
    this.setupTransports(modules);
    this.setupAPIs(modules);
  }

  public async start(): Promise<void> {
    await Promise.all(this.transports.map((transport) => transport.start()));
  }

  public async stop(): Promise<void> {
    await Promise.all(this.transports.map((transport) => transport.stop()));
  }

  private setupTransports(modules: IApiModules): void {
    this.opts.transports.forEach((transportType) => {
      switch (transportType) {
        case TransportType.HTTP: {
          this.transports.push(new HttpServer(this.opts.http, {logger: modules.logger}));
        } break;
        case TransportType.WS: {
          this.transports.push(new WSServer(this.opts.ws, {logger: modules.logger}));
        } break;
        default: {
          this.logger.warn(`Transport ${transportType} is not supported in RPC`);
        }
      }
    });
  }

  private setupAPIs(modules: IApiModules): void {
    this.transports.forEach((transport) => {
      // attach the json-rpc server to underlying transport
      const rpcServer = new jsonRpc.Server(transport);
      const jsonRpcApi = rpcServer.api();
      Object.values(apis).forEach((api) => {
        if (api.name.startsWith("I")) return;
        const apiInstance = new (api as IApiConstructor)(null, modules);
        // collect the api methods into an enumerable object for rpc exposure
        const methods = {};
        for (const name of Object.getOwnPropertyNames(Object.getPrototypeOf(apiInstance))) {
          //@ts-ignore
          if (name !== "constructor" && typeof apiInstance[name] === "function") {
            //@ts-ignore
            methods[name] = apiInstance[name].bind(apiInstance);
          }
        }
        if(this.opts.api.includes(apiInstance.namespace)) {
          jsonRpcApi[apiInstance.namespace].expose(methods);
        }
      });
      this.transports.push(transport);
    });
  }
}