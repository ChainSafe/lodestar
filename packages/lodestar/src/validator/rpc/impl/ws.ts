import {IBeaconApi} from "../../../api/rpc/api/beacon";
import {IValidatorApi} from "../../../api/rpc/api/validator";
import * as jsonRpc from "noice-json-rpc";
import Websocket from "ws";
import promisify from "promisify-es6";
import {AbstractRpcClient} from "../abstract";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

export interface RpcClientOverWsOpts {

  rpcUrl: string;

}

export class RpcClientOverWs extends AbstractRpcClient {

  public beacon: IBeaconApi;

  public validator: IValidatorApi;

  private socket: Websocket;

  private rpcUrl: string;

  public constructor(opts: RpcClientOverWsOpts, {config}: {config: IBeaconConfig}) {
    super();
    this.rpcUrl = opts.rpcUrl;
    this.config = config;
  }

  public async connect(): Promise<void> {
    await super.connect();
    this.socket = new Websocket(this.rpcUrl);
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
