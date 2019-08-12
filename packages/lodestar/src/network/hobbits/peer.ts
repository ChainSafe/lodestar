/**
 * @module network/hobbits
 */

import {
  Hello, Status, RequestBody, ResponseBody
} from "@chainsafe/eth2.0-types";
import {Method} from "../../constants";
import {HobbitsConnectionHandler} from "./hobbitsConnectionHandler";
import net from "net";
import {HobbitsUri} from "./hobbitsUri";
import {peerInfoToAddress} from "./util";
import PeerInfo from "peer-info";
import {promisify} from "util";

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
    if(this.connection && !this.connection.destroyed){
      return;
    }

    // Attempt to connect to peer, if connection refused remove the peer from bootnodes.
    const that = this;
    return new Promise((resolve, reject): void => {
      const nodeAddress = peerInfoToAddress(this.peerInfo).nodeAddress();
      that.connection = net.createConnection({
        host: nodeAddress.address, port: parseInt(nodeAddress.port)
      });
      that.connection.on('connect', ()=>{
        that.controller.logger.info(`Hobbits :: connected to: ${that.peerInfo.id.toB58String()}.`);
        resolve();
      });
      that.connection.on('error', () => {
        that.controller.logger.info(`Hobbits :: error connection of : ${that.peerInfo.id.toB58String()}.`);
        that.controller.onConnectionEnd(that.peerInfo);
        reject();
      });
      that.setEventListeners(that);
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

  public async close(): Promise<void> {
    try {
      await promisify(this.connection.end.bind(this.connection))();
    } catch (e) {
      this.controller.logger.error(e);
    }
  }

  public setConnection(connection: net.Socket): void {
    this.connection = connection;
    this.setEventListeners(this);
  }

  public setEventListeners(that: Peer): void {
    // Set to keep the connection alive
    that.connection.setKeepAlive(true);

    that.connection.on('data', (data) => {
      that.controller.onRequestResponse(that, data);
    });

    that.connection.on('end', () => {
      // that.controller.logger.info(`Hobbits :: ended connection of : ${that.peerInfo.id.toB58String()}.`);
      that.controller.onConnectionEnd(that.peerInfo);
    });
  }
}
