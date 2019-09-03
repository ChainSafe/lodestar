import {IBeaconApi} from "../../../api/rpc/api/beacon";
import {IValidatorApi} from "../../../api/rpc/api/validator";
import {AbstractRpcClient} from "../abstract";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

export interface RpcClientOverInstanceOpts {
  config: IBeaconConfig;
  beacon: IBeaconApi;
  validator: IValidatorApi;
}

export class RpcClientOverInstance extends AbstractRpcClient {

  public beacon: IBeaconApi;

  public validator: IValidatorApi;

  public constructor(opts: RpcClientOverInstanceOpts) {
    super();
    this.beacon = opts.beacon;
    this.validator = opts.validator;
    this.config = opts.config;
  }

  public async connect(): Promise<void> {
    await super.connect();
    return null;
  }

  public async disconnect(): Promise<void> {
    await super.disconnect();
    return null;
  }

}
