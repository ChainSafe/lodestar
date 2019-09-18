/**
 * @module api/rpc/transport
 */


import {LikeSocketServer} from "noice-json-rpc";
import {IService} from "../../../node";

export * from "./ws";
export * from "./http";
export enum TransportType {
  WS= "ws",
  HTTP= "http"
}

export interface IRpcServer extends LikeSocketServer, IService {

}