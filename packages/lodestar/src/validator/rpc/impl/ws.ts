import {IBeaconApi} from "../../../rpc/api/beacon";
import {IValidatorApi} from "../../../rpc/api/validator";
import * as jsonRpc from "noice-json-rpc";
import Websocket from "packages/beaconChain/src/validator/rpc/impl/ws";
import promisify from "promisify-es6";
import {AbstractRpcClient} from "../abstract";

export interface RpcClientOverWsOpts {

  rpcUrl: string;

}

export class RpcClientOverWs extends AbstractRpcClient {

  public beacon: IBeaconApi;

  public validator: IValidatorApi;

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
