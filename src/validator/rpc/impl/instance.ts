import {IBeaconApi} from "../../../rpc/api/beacon";
import {IValidatorApi} from "../../../rpc/api/validator";
import {AbstractRpcClient} from "../abstract";

export interface RpcClientOverInstanceOpts {
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
