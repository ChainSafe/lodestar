/**
 * @module network/libp2p
 */

import PeerInfo from "peer-info";
// @ts-ignore
import Connection from "interface-connection";
import pull from "pull-stream";
import pushable, {Pushable} from "pull-pushable";
// @ts-ignore
import Abortable from "pull-abortable";
import {Hello, Status} from "@chainsafe/eth2.0-types";

import {NetworkRpc} from "./rpc";


export class Peer {
  public peerInfo: PeerInfo;
  public latestHello: Hello | null;
  public latestStatus: Status | null;
  private conn: Connection;
  private stream: Pushable;
  private controller: NetworkRpc;
  // @ts-ignore
  private pull;
  // @ts-ignore
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
      this.pullAbort.abort(new Error("aborted"));
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
            if (err && err.message !== "aborted") {
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

  public close(): void {
    this.stream.end();
    this._close();
  }

  private _close(): void {
    this.conn = null;
  }
}
