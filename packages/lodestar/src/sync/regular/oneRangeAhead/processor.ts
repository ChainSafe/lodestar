import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {Root, SignedBeaconBlock} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {AbortSignal} from "abort-controller";
import {IRegularSyncModules} from "..";
import {ChainEvent, IBeaconChain} from "../../../chain";
import {BlockError, BlockErrorCode} from "../../../chain/errors";
import {sortBlocks} from "../../utils";
import {IBlockRangeProcessor} from "./interface";

/**
 * Process a block range until complete.
 */
export class BlockRangeProcessor implements IBlockRangeProcessor {
  protected readonly config: IBeaconConfig;
  private readonly chain: IBeaconChain;
  private readonly logger: ILogger;
  private target: {root: Root; resolve: () => void; signal: AbortSignal} | null;
  constructor(modules: Pick<IRegularSyncModules, "config" | "chain" | "logger">) {
    this.config = modules.config;
    this.chain = modules.chain;
    this.logger = modules.logger;
    this.target = null;
  }

  public async start(): Promise<void> {
    this.chain.emitter.on(ChainEvent.block, this.onProcessedBlock);
    this.chain.emitter.on(ChainEvent.errorBlock, this.onErrorBlock);
  }

  public async stop(): Promise<void> {
    this.chain.emitter.removeListener(ChainEvent.block, this.onProcessedBlock);
    this.chain.emitter.removeListener(ChainEvent.errorBlock, this.onErrorBlock);
  }

  /**
   * Main method.
   */
  public async processUntilComplete(blocks: SignedBeaconBlock[], signal: AbortSignal): Promise<void> {
    if (!blocks || !blocks.length) return;
    await new Promise((resolve) => {
      const sortedBlocks = sortBlocks(blocks);
      this.logger.info("Imported blocks for slots", {blocks: blocks.map((block) => block.message.slot)});
      const lastRoot = this.config.types.BeaconBlock.hashTreeRoot(sortedBlocks[sortedBlocks.length - 1].message);
      this.target = {
        root: lastRoot,
        resolve,
        signal,
      };
      for (const block of sortedBlocks) {
        // eslint-disable-next-line @typescript-eslint/no-floating-promises
        this.chain.receiveBlock(block);
      }
    });
  }

  private onProcessedBlock = (signedBlock: SignedBeaconBlock): void => {
    if (!this.target) return;
    if (this.target.signal.aborted) this.target.resolve();
    const root = this.config.types.BeaconBlock.hashTreeRoot(signedBlock.message);
    if (this.config.types.Root.equals(root, this.target.root)) {
      this.target.resolve();
    }
  };

  private onErrorBlock = async (err: BlockError): Promise<void> => {
    if (err.type.code === BlockErrorCode.ERR_BLOCK_IS_ALREADY_KNOWN) {
      await this.onProcessedBlock(err.job.signedBlock);
    }
  };
}
