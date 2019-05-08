import {RpcClient} from "../interface";
import {BeaconApi} from "../../../rpc/api/beacon";
import {ValidatorApi} from "../../../rpc/api/validator";
import {Epoch, Slot} from "../../../types";

export interface RpcClientOverInstanceOpts {
  beacon: BeaconApi;
  validator: ValidatorApi;
}

export class RpcClientOverInstance implements RpcClient{

  public beacon: BeaconApi;

  public validator: ValidatorApi;

  public constructor(opts: RpcClientOverInstanceOpts) {
    this.beacon = opts.beacon;
    this.validator = opts.validator;
  }

  public async connect(): Promise<void> {
    return null;
  }

  public async disconnect(): Promise<void> {
    return null;
  }

  public onEpoch(cb: (epoch: Epoch) => void) {
    //TODO: implement some subscription api in beacon
  }

  public onNewSlot(cb: (slot: Slot) => void) {
    //TODO: implement some subscription api in beacon
  }

}
