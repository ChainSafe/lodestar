/**
 * @module network/libp2p
 */

import PeerInfo from "peer-info";
import Connection from "interface-connection";
import pull from "pull-stream";
import pushable, {Pushable} from "pull-pushable";
import Abortable from "pull-abortable";

import {
  Hello, Goodbye, BeaconBlockRootsRequest, BeaconBlockHeadersRequest, BeaconBlockBodiesRequest,
  BeaconStatesRequest, RequestBody, BeaconBlockRootsResponse, BeaconBlockHeadersResponse,
  BeaconBlockBodiesResponse, BeaconStatesResponse, Status
} from "../../types";
import {IPeer} from "../interface";
import {Method} from "../codec";
import {RpcController} from "./rpcController";


export class Peer implements IPeer {
  public peerInfo: PeerInfo;
  public latestHello: Hello | null;
  public latestStatus: Status | null;
  private conn: Connection;
  private stream: Pushable;
  private controller: RpcController;
  private pull;
  private pullAbort;

  public constructor (peerInfo: PeerInfo, controller: RpcController) {
    this.peerInfo = peerInfo;
    this.controller = controller;
    this.latestHello = null;
    this.latestStatus = null;
    this.stream = pushable();
    this.pull = null;
    this.pullAbort = null;
  }

  public async setConnection(conn: Connection, abortCurrent: boolean): Promise<void> {
    if (this.pull && !abortCurrent) {
      return;
    }
    if (this.pull) {
      this.pullAbort.abort(new Error('aborted'));
      await this.pull;
    }
    this.stream = pushable();
    this.pullAbort = Abortable();
    this.pull = new Promise((resolve) => {
      pull(
        this.stream,
        conn,
        this.pullAbort,
        pull.drain(
          (data) => this.controller.onRequestResponse(this, data),
          (err) => {
            if (err && err.message !== 'aborted') {
              this.controller.onConnectionEnd(this.peerInfo);
            }
            return true;
          },
        )
      );
      resolve();
    });
  }

  public write(msg: Buffer): void {
    this.stream.push(msg);
  }

  private _close(): void {
    this.conn = null;
    this.stream = null;
  }

  public close(): void {
    this.stream.end();
    this._close();
  }

  public onRequest(method: Method, body: RequestBody): void {
    switch (method) {
      case Method.Hello:
        this.latestHello = body as Hello;
        break;
      case Method.Status:
        this.latestStatus = body as Status;
        break;
    }
  }

  public async hello(request: Hello): Promise<Hello> {
    const id = this.controller.sendRequest(this, Method.Hello, request);
    return await this.controller.getResponse<Hello>(id);
  }

  public async goodbye(request: Goodbye): Promise<void> {
    this.controller.sendRequest(this, Method.Goodbye, request);
    return;
  }

  public async getStatus(request: Status): Promise<Status> {
    const id = this.controller.sendRequest(this, Method.Status, request);
    return await this.controller.getResponse<Status>(id);
  }

  public async getBeaconBlockRoots(request: BeaconBlockRootsRequest): Promise<BeaconBlockRootsResponse> {
    const id = this.controller.sendRequest(this, Method.BeaconBlockRoots, request);
    return await this.controller.getResponse<BeaconBlockRootsResponse>(id);
  }

  public async getBeaconBlockHeaders(request: BeaconBlockHeadersRequest): Promise<BeaconBlockHeadersResponse> {
    const id = this.controller.sendRequest(this, Method.BeaconBlockHeaders, request);
    return await this.controller.getResponse<BeaconBlockHeadersResponse>(id);
  }

  public async getBeaconBlockBodies(request: BeaconBlockBodiesRequest): Promise<BeaconBlockBodiesResponse> {
    const id = this.controller.sendRequest(this, Method.BeaconBlockBodies, request);
    return await this.controller.getResponse<BeaconBlockBodiesResponse>(id);
  }

  public async getBeaconStates(request: BeaconStatesRequest): Promise<BeaconStatesResponse> {
    const id = this.controller.sendRequest(this, Method.BeaconStates, request);
    return await this.controller.getResponse<BeaconStatesResponse>(id);
  }
}
