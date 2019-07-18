/**
 * @module network/hobbits
 */

import {
  Hello, Status, RequestBody, ResponseBody
} from "../../types";
import {Method} from "../../constants";
import {HobbitsConnectionHandler} from "./hobbitsConnectionHandler";
import net from "net";
import {HobbitsUri} from "./hobbitsUri";
import {peerInfoToAddress} from "./util";


export class Peer {
  public peerInfo: PeerInfo;
  public latestHello: Hello | null;
  public latestStatus: Status | null;
  private connection: net.Socket;
  private controller: HobbitsConnectionHandler;

  public constructor (peerInfo: PeerInfo, controller: HobbitsConnectionHandler) {
    this.peerInfo = peerInfo;
    this.controller = controller;

    this.latestHello = null;
    this.latestStatus = null;
  }

  public async connect(): Promise<void> {
    // Abort if already connected
    // TODO: Properly check whether disconnected or not
    if(this.connection){
      return;
    }

    // Attempt to connect to peer, if connection refused remove the peer from bootnodes.
    const that = this;
    return new Promise((resolve, reject): void => {
      const nodeAddress = peerInfoToAddress(this.peerInfo).nodeAddress();
      that.connection = net.createConnection({
        host: nodeAddress.address, port: parseInt(nodeAddress.port)
      });
      // Set to keep the connection alive
      that.connection.setKeepAlive(true);
      that.connection.on('connect', ()=>{
        that.controller.logger.info(`Hobbits :: connected to: ${that.peerInfo.id.toB58String()}.`);
        resolve();
      });
      that.connection.on('error', () =>{
        that.controller.onConnectionEnd(that.peerInfo);
        reject();
      });
      that.connection.on('data', (data) => {
        that.controller.onRequestResponse(that, data);
      });
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
