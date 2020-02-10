import {IBeaconClock} from "../interface";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {computeEpochAtSlot, getCurrentSlot} from "@chainsafe/eth2.0-state-transition";
import {Epoch, Slot} from "@chainsafe/eth2.0-types";

type NewSlotCallback = (slot: Slot) => void;
type NewEpochCallback = (epoch: Epoch) => void;

export class LocalClock implements IBeaconClock {

    private readonly config: IBeaconConfig;
    private readonly genesisTime: number;
    private currentSlot: number;
    private isRunning: boolean;
    private newSlotCallbacks: NewSlotCallback[] = [];
    private newEpochCallbacks: NewEpochCallback[] = [];


    public constructor(config: IBeaconConfig, genesisTime: number) {
        this.config = config;
        this.genesisTime = genesisTime;
        //this assumes clock time is trusted
        this.currentSlot = getCurrentSlot(this.config, this.genesisTime);
    }

    public async start(): Promise<void> {
        this.isRunning = true;
        const diffTillNextSlot = this.getDiffTillNextSlot();
        setTimeout(
            this.updateSlot,
            diffTillNextSlot
        );
    }
    public async stop(): Promise<void> {
        this.isRunning = false;
    }

    public getCurrentSlot(): number {
        return this.currentSlot;
    }

    public onNewEpoch(cb: NewEpochCallback): void {
        if(cb) {
            this.newEpochCallbacks.push(cb);
        }
    }

    public onNewSlot(cb: NewSlotCallback): void {
        if(cb) {
            this.newSlotCallbacks.push(cb);
        }
    }

    private updateSlot = () => {
        if(!this.isRunning) {
            return;
        }
        const previousSlot = this.currentSlot;
        this.currentSlot++;
        this.newSlotCallbacks.forEach((cb) => {
            cb(this.currentSlot);
        });
        const currentEpoch = computeEpochAtSlot(this.config, this.currentSlot);
        if(computeEpochAtSlot(this.config, previousSlot) < currentEpoch) {
            this.newEpochCallbacks.forEach((cb) => {
                cb(currentEpoch);
            })
        }
        //recursively invoke update slot
        setTimeout(
            this.updateSlot,
            this.getDiffTillNextSlot()
        );
    };

    private getDiffTillNextSlot(): number {
        const diffInSeconds = (Date.now() / 1000) - this.genesisTime;
        return (this.config.params.SECONDS_PER_SLOT - diffInSeconds % this.config.params.SECONDS_PER_SLOT) * 1000;
    }
}