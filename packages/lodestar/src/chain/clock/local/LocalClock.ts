import {IBeaconClock, NewEpochCallback, NewSlotCallback} from "../interface";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {computeEpochAtSlot, getCurrentSlot} from "@chainsafe/eth2.0-state-transition";
import {EventEmitter} from "events";

export class LocalClock extends EventEmitter implements IBeaconClock {

  private readonly config: IBeaconConfig;
  private readonly genesisTime: number;
  private currentSlot: number;
  private isRunning: boolean;
  private timeoutId: NodeJS.Timeout;

  public constructor(config: IBeaconConfig, genesisTime: number) {
    super();
    this.config = config;
    this.genesisTime = genesisTime;
    //this assumes clock time is trusted
    this.currentSlot = getCurrentSlot(this.config, this.genesisTime);
  }

  public async start(): Promise<void> {
    this.isRunning = true;
    const diffTillNextSlot = this.getDiffTillNextSlot();
    this.timeoutId = setTimeout(
      this.updateSlot,
      diffTillNextSlot
    );
  }
  public async stop(): Promise<void> {
    this.isRunning = false;
    clearTimeout(this.timeoutId);
  }

  public getCurrentSlot(): number {
    return this.currentSlot;
  }

  public onNewEpoch(cb: NewEpochCallback): void {
    this.on("epoch", cb);
  }

  public onNewSlot(cb: NewSlotCallback): void {
    this.on("slot", cb);
  }

  public unsubscribeFromNewEpoch(cb: NewEpochCallback): void {
    this.removeListener("epoch", cb);
  }

  public unsubscribeFromNewSlot(cb: NewSlotCallback): void {
    this.removeListener("slot", cb);
  }

  private updateSlot = (): void => {
    if(!this.isRunning) {
      return;
    }
    const previousSlot = this.currentSlot;
    this.currentSlot++;
    this.emit("slot", this.currentSlot);
    const currentEpoch = computeEpochAtSlot(this.config, this.currentSlot);
    if(computeEpochAtSlot(this.config, previousSlot) < currentEpoch) {
      this.emit("epoch", currentEpoch);
    }
    //recursively invoke update slot
    this.timeoutId = setTimeout(
      this.updateSlot,
      this.getDiffTillNextSlot()
    );
  };

  private getDiffTillNextSlot(): number {
    const diffInSeconds = (Date.now() / 1000) - this.genesisTime;
    return (this.config.params.SECONDS_PER_SLOT - diffInSeconds % this.config.params.SECONDS_PER_SLOT) * 1000;
  }
}