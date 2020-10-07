import {Pushable} from "it-pushable";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";

import {IBlockProcessJob} from "../interface";
import {ChainEventEmitter} from "../emitter";
import {IForkChoice} from "@chainsafe/lodestar-fork-choice";
import {findUnknownAncestor} from "./util";

export class BlockPool {
  private unknownParentBlockPool = new Map<string, IBlockProcessJob[]>();
  private pendingSlotBlockPool = new Map<Slot, IBlockProcessJob[]>();

  private readonly config: IBeaconConfig;
  private readonly blockProcessorSource: Pushable<IBlockProcessJob>;
  private readonly eventBus: ChainEventEmitter;
  private readonly forkChoice: IForkChoice;

  constructor(
    config: IBeaconConfig,
    blockProcessorSource: Pushable<IBlockProcessJob>,
    eventBus: ChainEventEmitter,
    forkChoice: IForkChoice
  ) {
    this.config = config;
    this.blockProcessorSource = blockProcessorSource;
    this.eventBus = eventBus;
    this.forkChoice = forkChoice;
  }

  public addPendingBlock(job: IBlockProcessJob): void {
    const key = this.getKey(job.signedBlock);
    const pendingBlockPool = this.unknownParentBlockPool.get(key);
    if (pendingBlockPool) {
      pendingBlockPool.push(job);
    } else {
      this.unknownParentBlockPool.set(key, [job]);
      //this prevents backward syncing, tolerance is 20 blocks
      if (job.signedBlock.message.slot <= this.forkChoice.getHead().slot + 20) {
        const pendingBlocks = Array.from(this.unknownParentBlockPool.values()).flat();
        this.eventBus.emit(
          "unknownBlockRoot",
          findUnknownAncestor(this.config, pendingBlocks, job.signedBlock.message.parentRoot)
        );
      }
    }
  }

  public addPendingSlotBlock(job: IBlockProcessJob): void {
    const pendingBlockPool = this.pendingSlotBlockPool.get(job.signedBlock.message.slot);
    if (pendingBlockPool) {
      pendingBlockPool.push(job);
    } else {
      this.pendingSlotBlockPool.set(job.signedBlock.message.slot, [job]);
    }
  }

  public onProcessedBlock(block: SignedBeaconBlock): void {
    const key = toHexString(this.config.types.BeaconBlock.hashTreeRoot(block.message));
    const jobs = this.unknownParentBlockPool.get(key);
    if (jobs) {
      this.unknownParentBlockPool.delete(key);
      jobs
        .sort((a, b) => a.signedBlock.message.slot - b.signedBlock.message.slot)
        .forEach((job) => {
          this.blockProcessorSource.push(job);
        });
    }
  }

  public onNewSlot = (slot: Slot): void => {
    const jobs = this.pendingSlotBlockPool.get(slot) ?? [];
    jobs.forEach((job) => this.blockProcessorSource.push(job));
    this.pendingSlotBlockPool.delete(slot);
  };

  private getKey(block: SignedBeaconBlock): string {
    return toHexString(block.message.parentRoot);
  }
}
