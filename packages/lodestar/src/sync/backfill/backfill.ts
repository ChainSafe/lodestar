import {computeStartSlotAtEpoch, verifyBlockSignature} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {GENESIS_EPOCH} from "@chainsafe/lodestar-params";
import {phase0, Root, Slot} from "@chainsafe/lodestar-types";
import {SignedBeaconBlock} from "@chainsafe/lodestar-types/lib/allForks";
import {ErrorAborted, ILogger, LodestarError} from "@chainsafe/lodestar-utils";
import {List} from "@chainsafe/ssz";
import PeerId from "peer-id";
import {ItTrigger} from "../../../lib/util/itTrigger";
import {IBeaconChain} from "../../chain";
import {getMinEpochForBlockRequests} from "../../constants";
import {IBeaconDb} from "../../db";
import {INetwork, NetworkEvent} from "../../network";
import {PeerMap} from "../../util/peerMap";
import {ChainTarget, SyncChainFns} from "../range/chain";
import {BackfillSyncError, BackfillSyncErrorCode} from "./errors";
import {getRandomPeer} from "./util";
import {verifyBlocks} from "./verify";

export enum BackfillSyncStatus {
  /** Required history blocks are syncing */
  Syncing,

  /** There are no suitable peers or we synced all required history blocks */
  Idle,
}

type BackfillSyncState =
  | {
      status: BackfillSyncStatus.Syncing;
      target: ChainTarget;
    }
  | {status: BackfillSyncStatus.Idle};

export type RangeSyncModules = {
  chain: IBeaconChain;
  db: IBeaconDb;
  network: INetwork;
  config: IBeaconConfig;
  logger: ILogger;
};

export type BackfillSyncOpts = {
  batchSize: number;
};

export class BackfillSync {
  private readonly chain: IBeaconChain;
  private readonly network: INetwork;
  private readonly db: IBeaconDb;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private opts: BackfillSyncOpts;
  //last fetched slot
  private lastFetchedSlot: Slot | null = null;
  //last trusted block
  private anchorBlock: SignedBeaconBlock | null = null;
  private processor: ItTrigger = new ItTrigger();
  private peers: PeerMap<phase0.Status> = new PeerMap();

  constructor(modules: RangeSyncModules, opts?: BackfillSyncOpts) {
    this.chain = modules.chain;
    this.network = modules.network;
    this.db = modules.db;
    this.config = modules.config;
    this.logger = modules.logger;
    this.opts = opts ?? {batchSize: 32};
    this.network.events.addListener(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.addListener(NetworkEvent.peerDisconnected, this.removePeer);
    void this.init();
  }

  /** Throw / return all AsyncGenerators */
  close(): void {
    this.network.events.removeListener(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.removeListener(NetworkEvent.peerDisconnected, this.removePeer);
    this.processor.end(new ErrorAborted("BackfillSync"));
  }

  async init(): Promise<void> {
    const anchorState = this.chain.getHeadState();
    const parentBlockRoot: Root = anchorState.latestBlockHeader.parentRoot;
    this.anchorBlock = await this.db.blockArchive.getByRoot(parentBlockRoot);
    void this.sync();
  }

  async sync(): Promise<void> {
    try {
      for await (const _ of this.processor) {
        if (this.peers.size === 0) continue;

        const oldestRequiredEpoch = Math.max(
          GENESIS_EPOCH,
          this.chain.clock.currentEpoch - getMinEpochForBlockRequests(this.config)
        );
        const oldestSlotRequired = computeStartSlotAtEpoch(this.config, oldestRequiredEpoch);

        if (this.anchorBlock) {
          try {
            const toSlot = this.lastFetchedSlot ?? this.anchorBlock.message.slot;
            const fromSlot = Math.max(toSlot - this.opts.batchSize, oldestSlotRequired);
            if (fromSlot >= toSlot) {
              this.logger.info("Backfill sync completed");
              break;
            }
            await this.syncRange(fromSlot, toSlot, this.anchorBlock.message.parentRoot);
          } catch (e) {
            this.logger.debug("Error while backfiling by range", e);
          }
        } else {
          try {
            await this.syncBlock(this.chain.getHeadState().latestBlockHeader.parentRoot);
          } catch (e) {
            this.logger.debug("Error while backfilling anchor block", e);
          }
        }
      }
    } catch (e) {
      if (e instanceof ErrorAborted) {
        return; // Ignore
      }
      this.logger.error("BackfillSync Error", e);
    }
  }

  private async addPeer(peerId: PeerId, peerStatus: phase0.Status): Promise<void> {
    const requiredSlot = this.anchorBlock?.message.slot ?? this.chain.getHeadState().slot;
    if (peerStatus.headSlot >= requiredSlot) {
      this.peers.set(peerId, peerStatus);
      this.processor.trigger();
    }
  }

  /**
   * Remove this peer from all sync chains
   */
  private removePeer(peerId: PeerId): void {
    this.peers.delete(peerId);
  }

  private async syncBlock(root: Root): Promise<void> {
    const peer = getRandomPeer(this.peers.keys());
    try {
      const blocks = await this.network.reqResp.beaconBlocksByRoot(peer, [root] as List<Root>);
      if (blocks.length === 0) {
        throw new BackfillSyncError({code: BackfillSyncErrorCode.MISSING_BLOCKS, peerId: peer});
      }
      const block = blocks[0] as SignedBeaconBlock;
      try {
        verifyBlockSignature(this.config, this.chain.getHeadState(), block);
      } catch (e) {
        throw new BackfillSyncError({code: BackfillSyncErrorCode.INVALID_SIGNATURE});
      }

      await this.db.blockArchive.put(block.message.slot, block);
      this.anchorBlock = block;
      this.processor.trigger();
    } catch (e) {
      this.peers.delete(peer);
      setTimeout(this.processor.trigger, 2000);
      throw e;
    }
  }

  private async syncRange(from: Slot, to: Slot, anchorRoot: Root): Promise<void> {
    const peer = getRandomPeer(this.peers.keys());
    try {
      const blocks = await this.network.reqResp.beaconBlocksByRange(peer, {startSlot: from, count: to - from, step: 1});
      await verifyBlocks(this.config, this.chain.bls, this.chain.getHeadState(), blocks, anchorRoot);
      await this.db.blockArchive.batchAdd(blocks);
      this.anchorBlock = blocks[blocks.length - 1];
      this.processor.trigger();
    } catch (e) {
      if ((e as BackfillSyncError).type.code === BackfillSyncErrorCode.NOT_ANCHORED) {
        this.lastFetchedSlot = this.anchorBlock?.message.slot ?? null;
      }
      this.peers.delete(peer);
      setTimeout(this.processor.trigger, 2000);
      throw e;
    }
  }
}
