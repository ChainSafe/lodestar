import {ChainForkConfig} from "@lodestar/config";
import {INTERVALS_PER_SLOT} from "@lodestar/params";
import {RootHex} from "@lodestar/types";
import {Logger} from "@lodestar/utils";
import {BlockInput} from "../chain/blocks/blockInput/index.js";
import {IBeaconChain} from "../chain/index.js";
import {Metrics} from "../metrics/index.js";
import {INetwork, NetworkEvent} from "../network/index.js";
import {SyncOptions} from "./options.js";

const MAX_PENDING_BLOCKS = 100;

export enum PendingBlockInputStatus {
  pending = "pending",
  fetching = "fetching",
  downloaded = "downloaded",
  processing = "processing",
}

export type PendingBlockInput = {
  status: PendingBlockInputStatus;
  blockInput: BlockInput;
  peerIdStrings: Set<string>;
  downloadAttempts: number;
};

export type IncompleteAndAncestorBlocks = {
  incomplete: PendingBlockInput[];
  ancestors: PendingBlockInput[];
};

export class BlockInputSync {
  /**
   * block RootHex -> PendingBlock. To avoid finding same root at the same time
   */
  private readonly pendingBlocks = new Map<RootHex, PendingBlockInput>();
  private readonly knownBadBlocks = new Set<RootHex>();
  private readonly proposerBoostSecWindow: number;
  private readonly maxPendingBlocks;
  private subscribedToNetworkEvents = false;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly network: INetwork,
    private readonly chain: IBeaconChain,
    private readonly logger: Logger,
    private readonly metrics: Metrics | null,
    private readonly opts?: SyncOptions
  ) {
    this.maxPendingBlocks = opts?.maxPendingBlocks ?? MAX_PENDING_BLOCKS;
    this.proposerBoostSecWindow = this.config.SECONDS_PER_SLOT / INTERVALS_PER_SLOT;

    if (metrics) {
      //   metrics.syncBlockInput.pendingBlocks.addCollect(() =>
      //     metrics.syncBlockInput.pendingBlocks.set(this.pendingBlocks.size)
      //   );
      //   metrics.syncBlockInput.knownBadBlocks.addCollect(() =>
      //     metrics.syncBlockInput.knownBadBlocks.set(this.knownBadBlocks.size)
      //   );
    }
  }

  subscribeToNetwork(): void {
    if (!this.subscribedToNetworkEvents) {
      this.logger.verbose("BlockInputSync enabled.");
      //   this.network.events.on(NetworkEvent.blockInput, this.onBlockInput);
      //   this.network.events.on(NetworkEvent.unknownParent, this.onUnknownParent);
      //   this.network.events.on(NetworkEvent.peerConnected, this.triggerUnknownBlockSearch);
      this.subscribedToNetworkEvents = true;
    }
  }

  unsubscribeFromNetwork(): void {
    this.logger.verbose("BlockInputSync disabled.");
    // this.network.events.off(NetworkEvent.blockInput, this.onBlockInput);
    // this.network.events.off(NetworkEvent.unknownParent, this.onUnknownParent);
    // this.network.events.off(NetworkEvent.peerConnected, this.triggerUnknownBlockSearch);
    this.subscribedToNetworkEvents = false;
  }

  close(): void {
    this.unsubscribeFromNetwork();
  }

  isSubscribedToNetwork(): boolean {
    return this.subscribedToNetworkEvents;
  }
}
