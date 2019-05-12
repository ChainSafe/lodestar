import {BeaconApi} from "../../../rpc/api/beacon";
import {ValidatorApi} from "../../../rpc/api/validator";
import * as jsonRpc from "noice-json-rpc";
import Websocket from "ws";
import promisify from "promisify-es6";
import {AbstractRpcClient} from "../abstract";

export interface RpcClientOverWsOpts {

  rpcUrl: string;

}

export class RpcClientOverWs extends AbstractRpcClient {

  public beacon: BeaconApi;

  public validator: ValidatorApi;

  private socket: Websocket;

  public constructor(opts: RpcClientOverWsOpts) {
    super();
    this.socket = new Websocket(opts.rpcUrl);
  }

  public async connect(): Promise<void> {
    await super.connect();
    const client = new jsonRpc.Client(this.socket);
    const clientApi = client.api();
    this.beacon = clientApi.beacon;
    this.validator = clientApi.validator;
  }

  public async disconnect(): Promise<void> {
    await super.disconnect();
    this.socket.terminate();
    return await promisify(this.socket.on.bind(this.socket))('close');
  }

}
