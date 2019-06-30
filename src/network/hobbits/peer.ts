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
import {Method} from "../../constants";
import {HobbitsRpc} from "./rpc";
import net from "net";
import {peerInfoToAddress} from "./util";


export class Peer {
  public peerInfo: PeerInfo;
  public latestHello: Hello | null;
  public latestStatus: Status | null;
  private connection: net.Socket;
  private controller: HobbitsRpc;

  public ip: string;
  public port?: number;

  public constructor (peerInfo: PeerInfo, controller: HobbitsRpc) {
    this.peerInfo = peerInfo;
    this.controller = controller;
    this.latestHello = null;
    this.latestStatus = null;

    let nodeAddr = peerInfoToAddress(peerInfo);
    this.ip = nodeAddr.address;
    this.port = parseInt(nodeAddr.port) || 9000;
  }

  public async connect(): Promise<void> {
    // Abort if already connected
    if(this.connection){
      return;
    }
    // Attempt to connect to peer, if connection refused remove the peer from bootnodes.
    const that = this;
    return new Promise((resolve, reject): void => {
      that.connection = net.createConnection({host: this.ip, port: this.port});
      // Set to keep the connection alive
      that.connection.setKeepAlive(true);
      that.connection.on('connect', ()=>{
        that.controller.logger.info("Connected with peer.");
      });
      that.connection.on('error', reject);
      that.connection.on('data', (data) => {
        that.controller.onRequestResponse(that, data);
      });
      resolve();
    });

    // this.stream = pushable();
    // this.pullAbort = Abortable();
    // this.pull = new Promise((resolve) => {
    //   pull(
    //     this.stream,
    //     conn,
    //     this.pullAbort,
    //     pull.drain(
    //       (data) => this.controller.onRequestResponse(this, data),
    //       (err) => {
    //         if (err && err.message !== 'aborted') {
    //           this.controller.onConnectionEnd(this.peerInfo);
    //         }
    //         return true;
    //       },
    //     )
    //   );
    //   resolve();
    // });
  }

  public write(msg: Buffer): void {
    this.connection.write(msg);
  }

  public close(): void {
    this.connection.destroy();
  }
}
