import {Epoch, Slot} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ApiClientEventEmitter, IApiClient, INewEpochCallback, INewSlotCallback} from "./interface";
import {computeEpochAtSlot, getCurrentSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconApi} from "./interface/beacon";
import {IValidatorApi} from "./interface/validators";
import {EventEmitter} from "events";
import {sleep} from "../util";
import {INodeApi} from "./interface/node";


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
  private slotCountingTimeout: NodeJS.Timeout;
  private genesisTime: number;

  public abstract url: string;
  abstract beacon: IBeaconApi;
  abstract node: INodeApi;
  abstract validator: IValidatorApi;

  protected constructor(config: IBeaconConfig) {
    super();
    this.config = config;
  }

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
    if(!this.beaconNodeInterval) {
      this.running = true;
      await this.pollBeaconNode();
      this.beaconNodeInterval = setInterval(this.pollBeaconNode.bind(this), 1000);
    }
  }

  public async disconnect(): Promise<void> {
    this.running = false;
    if(this.beaconNodeInterval) {
      clearInterval(this.beaconNodeInterval);
    }
    if(this.slotCountingTimeout) {
      clearTimeout(this.slotCountingTimeout);
    }
  }

  public getCurrentSlot(): Slot {
    return this.currentSlot;
  }

  private async pollBeaconNode(): Promise<void> {
    if (!this.running) {
      return;
    }
    const genesis =  await this.beacon.getGenesis();
    if (genesis && Math.floor(Date.now() / 1000) >= genesis.genesisTime) {
      this.emit("beaconChainStarted");
      clearInterval(this.beaconNodeInterval);
      this.startSlotCounting(Number(genesis.genesisTime));
    }
  }

  private startSlotCounting(genesisTime: number): void {
    this.genesisTime = genesisTime;
    this.currentSlot = getCurrentSlot(this.config, genesisTime);


    //subscribe to new slots and notify upon new epoch
    this.onNewSlot(this.updateEpoch);
    if(!this.slotCountingTimeout) {
      this.slotCountingTimeout = setTimeout(
        this.updateSlot,
        //delay to prevent validator requesting duties too early since we don't account for millis diff
        this.getDiffTillNextSlot()
      );
    }
  }

  private updateSlot = async(): Promise<void> => {
    if(!this.running) {
      return;
    }
    //to prevent sometime being updated prematurely
    if(this.currentSlot + 1 !== getCurrentSlot(this.config, this.genesisTime)) {
      await sleep(this.getDiffTillNextSlot());
    }
    this.currentSlot++;
    this.newSlotCallbacks.forEach((cb) => {
      cb(this.currentSlot);
    });
    //recursively invoke update slot after SECONDS_PER_SLOT
    this.slotCountingTimeout = setTimeout(
      this.updateSlot,
      this.getDiffTillNextSlot()
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

  /**
   * Returns milis till next slot
   */
  private getDiffTillNextSlot(): number {
    const diffInSeconds = Math.floor((Date.now() / 1000) - this.genesisTime);
    //update slot after remaining seconds until next slot
    return (this.config.params.SECONDS_PER_SLOT - diffInSeconds % this.config.params.SECONDS_PER_SLOT) * 1000;
  }
}
