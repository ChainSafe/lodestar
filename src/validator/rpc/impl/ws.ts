import {RpcClient} from "../interface";
import {BeaconApi} from "../../../rpc/api/beacon";
import {ValidatorApi} from "../../../rpc/api/validator";
import {Epoch, Slot} from "../../../types";
import * as jsonRpc from "noice-json-rpc";
import Websocket from "ws";
import promisify from "promisify-es6";

export interface RpcClientOverWsOpts {

  rpcUrl: string;

}

export class RpcClientOverWs implements RpcClient{

  public beacon: BeaconApi;

  public validator: ValidatorApi;

  private socket: Websocket;

  public constructor(opts: RpcClientOverWsOpts) {
    this.socket = new Websocket(opts.rpcUrl);
  }

  public async connect(): Promise<void> {
    const client = new jsonRpc.Client(this.socket);
    const clientApi = client.api();
    this.beacon = clientApi.beacon;
    this.validator = clientApi.validator;
  }

  public async disconnect(): Promise<void> {
    this.socket.terminate();
    return await promisify(this.socket.on.bind(this.socket))('close');
  }

  public onNewEpoch(cb: (epoch: Epoch) => void): void {
  }

  public onNewSlot(cb: (slot: Slot) => void): void {
  }

}
