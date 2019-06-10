/**
 * @module network/libp2p
 */

import PeerInfo from "peer-info";
import Connection from "interface-connection";
import pull from "pull-stream";
import pushable, {Pushable} from "pull-pushable";
import Abortable from "pull-abortable";

import {
  Hello, Status, RequestBody, ResponseBody
} from "../../types";
import {IPeer} from "../interface";
import {Method} from "../codec";
import {NetworkRpc} from "./rpc";


export class Peer implements IPeer {
  public peerInfo: PeerInfo;
  public latestHello: Hello | null;
  public latestStatus: Status | null;
  private conn: Connection;
  private stream: Pushable;
  private controller: NetworkRpc;
  private pull;
  private pullAbort;

  public constructor (peerInfo: PeerInfo, controller: NetworkRpc) {
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

  public async sendRequest<T extends ResponseBody>(method: Method, request: RequestBody): Promise<T> {
    const id = this.controller.sendRequest(this, method, request);
    return await this.controller.getResponse(id) as T;
  }
}
