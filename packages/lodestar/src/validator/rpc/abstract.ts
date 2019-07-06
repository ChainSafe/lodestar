import {NewEpochCallback, NewSlotCallback, RpcClient} from "./interface";
import {Slot} from "@chainsafe/eth2-types";
import {IValidatorApi} from "../../rpc/api/validator";
import {intDiv} from "../../util/math";
import {SECONDS_PER_SLOT} from "@chainsafe/eth2-types"
import {slotToEpoch} from "../../chain/stateTransition/util";
import {IBeaconApi} from "../../rpc/api/beacon";


export abstract class AbstractRpcClient implements RpcClient {

  private currentSlot: Slot;

  private currentEpoch: Slot;

  private newSlotCallbacks: NewSlotCallback[] = [];
  private newEpochCallbacks: NewEpochCallback[] = [];

  private running = false;

  public onNewEpoch(cb: NewEpochCallback): void {
    if (cb) {
      this.newEpochCallbacks.push(cb);
    }
  }

  public onNewSlot(cb: NewSlotCallback): void {
    if (cb) {
      this.newSlotCallbacks.push(cb);
    }
  }

  private async startSlotCounting(): Promise<void> {
    this.running = true;
    const genesisTime = await this.beacon.getGenesisTime();
    const diffInSeconds = (Date.now() / 1000) - genesisTime;
    this.currentSlot = intDiv(diffInSeconds, SECONDS_PER_SLOT);
    //update slot after remaining seconds until next slot
    const diffTillNextSlot = (SECONDS_PER_SLOT - diffInSeconds % SECONDS_PER_SLOT) * 1000;
    //subscribe to new slots and notify upon new epoch
    this.onNewSlot(this.updateEpoch.bind(this));
    const that = this;
    setTimeout(
      that.updateSlot.bind(that),
      diffTillNextSlot
    );
  }

  private updateSlot(): void {
    if(!this.running) {
      return;
    }
    this.currentSlot++;
    this.newSlotCallbacks.forEach((cb) => {
      cb(this.currentSlot);
    });
    //recursively invoke update slot after SECONDS_PER_SLOT
    const that = this;
    setTimeout(
      that.updateSlot.bind(that),
      SECONDS_PER_SLOT * 1000
    );
  }

  private updateEpoch(slot: Slot): void {
    const epoch = slotToEpoch(slot);
    if (epoch !== this.currentEpoch && epoch !== 0) {
      this.currentEpoch = epoch;
      this.newEpochCallbacks.forEach((cb) => {
        cb(this.currentEpoch);
      });
    }
  }

  abstract beacon: IBeaconApi;
  abstract validator: IValidatorApi;

  public async connect(): Promise<void> {
    await this.startSlotCounting();
  }

  public async disconnect(): Promise<void> {
    this.running = false;
  }

}
