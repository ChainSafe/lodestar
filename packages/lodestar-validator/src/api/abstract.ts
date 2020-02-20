import {Epoch, Slot} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {ApiClientEventEmitter, IApiClient, INewEpochCallback, INewSlotCallback} from "./interface";
import {computeEpochAtSlot, getCurrentSlot} from "@chainsafe/eth2.0-state-transition";
import {IBeaconApi} from "./interface/beacon";
import {IValidatorApi} from "./interface/validators";
import {EventEmitter} from "events";


export abstract class AbstractApiClient
  extends (EventEmitter as { new(): ApiClientEventEmitter })
  implements IApiClient {


  protected config: IBeaconConfig;

  private currentSlot: Slot = 0;
  private currentEpoch: Epoch = 0;
  private newSlotCallbacks: INewSlotCallback[] = [];
  private newEpochCallbacks: INewEpochCallback[] = [];
  private running = false;
  private beaconNodeInterval: NodeJS.Timeout;

  public abstract url: string;
  abstract beacon: IBeaconApi;
  abstract validator: IValidatorApi;

  public onNewEpoch(cb: INewEpochCallback): void {
    if (cb) {
      this.newEpochCallbacks.push(cb);
    }
  }

  public onNewSlot(cb: INewSlotCallback): void {
    if (cb) {
      this.newSlotCallbacks.push(cb);
    }
  }

  public async connect(): Promise<void> {
    await this.startSlotCounting();
    this.beaconNodeInterval = setInterval(this.pollBeaconNode.bind(this), 1000);
  }

  public async disconnect(): Promise<void> {
    this.running = false;
    if(this.beaconNodeInterval) {
      clearInterval(this.beaconNodeInterval);
    }
  }

  public getCurrentSlot(): Slot {
    return this.currentSlot;
  }

  private async pollBeaconNode(): Promise<void> {
    if (!this.running) {
      return;
    }
    const genesisTime =  await this.beacon.getGenesisTime();
    if (genesisTime && (Date.now() / 1000) > genesisTime) {
      this.emit("beaconChainStarted");
      clearInterval(this.beaconNodeInterval);
    }
  }

  private async startSlotCounting(): Promise<void> {
    this.running = true;
    const genesisTime = await this.beacon.getGenesisTime();
    const diffInSeconds = (Math.floor(Date.now() / 1000)) - genesisTime;
    this.currentSlot = getCurrentSlot(this.config, genesisTime);
    //update slot after remaining seconds until next slot
    const diffTillNextSlot =
        (this.config.params.SECONDS_PER_SLOT - diffInSeconds % this.config.params.SECONDS_PER_SLOT) * 1000;
    //subscribe to new slots and notify upon new epoch
    this.onNewSlot(this.updateEpoch);
    setTimeout(
      this.updateSlot,
      diffTillNextSlot
    );
  }

  private updateSlot = (): void => {
    if(!this.running) {
      return;
    }
    this.currentSlot++;
    this.newSlotCallbacks.forEach((cb) => {
      cb(this.currentSlot);
    });
    //recursively invoke update slot after SECONDS_PER_SLOT
    setTimeout(
      this.updateSlot,
      this.config.params.SECONDS_PER_SLOT * 1000
    );
  };

  private updateEpoch = (slot: Slot): void => {
    const epoch = computeEpochAtSlot(this.config, slot);
    if (epoch !== this.currentEpoch) {
      this.currentEpoch = epoch;
      this.newEpochCallbacks.forEach((cb) => {
        cb(this.currentEpoch);
      });
    }
  };

}
