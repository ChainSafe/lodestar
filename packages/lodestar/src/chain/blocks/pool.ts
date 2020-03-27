import {IBlockProcessJob} from "../chain";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {Pushable} from "it-pushable";

export class BlockPool {

  private pool = new Map<string, IBlockProcessJob[]>();

  private readonly config: IBeaconConfig;
  private readonly blockProcessorSource: Pushable<IBlockProcessJob>;

  constructor(config: IBeaconConfig, blockProcessorSource: Pushable<IBlockProcessJob>) {
    this.config = config;
    this.blockProcessorSource = blockProcessorSource;
  }

  public addPendingBlock(job: IBlockProcessJob): void {
    const key = this.getKey(job.signedBlock);
    if(this.pool.has(key)) {
      this.pool.get(key).push(job);
    } else {
      this.pool.set(key, [job]);
      //TODO: emit unknown block root event
    }
  }

  public onProcessedBlock(block: SignedBeaconBlock): void {
    const key = toHexString(this.config.types.BeaconBlock.hashTreeRoot(block.message));
    const jobs = this.pool.get(key);
    this.pool.delete(key);
    jobs
      .sort((a, b) => a.signedBlock.message.slot - b.signedBlock.message.slot)
      .forEach((job) => {
        this.blockProcessorSource.push(job);
      });
  }

  private getKey(block: SignedBeaconBlock): string {
    return toHexString(block.message.parentRoot);
  }
}