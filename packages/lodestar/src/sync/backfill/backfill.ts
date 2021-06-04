import {computeStartSlotAtEpoch} from "@chainsafe/lodestar-beacon-state-transition";
import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition/src/util/epoch";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {GENESIS_EPOCH} from "@chainsafe/lodestar-params";
import {Epoch, phase0} from "@chainsafe/lodestar-types";
import {ILogger} from "@chainsafe/lodestar-utils";
import {EventEmitter} from "events";
import PeerId from "peer-id";
import StrictEventEmitter from "strict-event-emitter-types";
import {IBeaconChain} from "../../chain";
import {getMinEpochForBlockRequests} from "../../constants";
import {IBeaconDb} from "../../db";
import {INetwork, NetworkEvent} from "../../network";
import {BatchOpts} from "../range/batch";
import {ChainTarget, SyncChain, SyncChainFns} from "../range/chain";
import {RangeSyncType} from "../utils";
import {verifyBlocks} from "./verify";

export enum BackfillSyncEvent {
  completedChain = "BackfillSync-completedChain",
}

type BackfillSyncEvents = {
  [BackfillSyncEvent.completedChain]: () => void;
};

type BackfillSyncEmitter = StrictEventEmitter<EventEmitter, BackfillSyncEvents>;

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

export type BackfillSyncOpts = BatchOpts;

export class BackfillSync extends (EventEmitter as {new (): BackfillSyncEmitter}) {
  private readonly chain: IBeaconChain;
  private readonly network: INetwork;
  private readonly db: IBeaconDb;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;
  private opts?: BackfillSyncOpts;

  private syncChain?: SyncChain;

  constructor(modules: RangeSyncModules, opts?: BackfillSyncOpts) {
    super();
    this.chain = modules.chain;
    this.network = modules.network;
    this.db = modules.db;
    this.config = modules.config;
    this.logger = modules.logger;
    this.opts = opts;
    void this.update();
    this.network.events.addListener(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.addListener(NetworkEvent.peerDisconnected, this.removePeer);
  }

  /** Throw / return all AsyncGenerators inside every SyncChain instance */
  close(): void {
    this.network.events.removeListener(NetworkEvent.peerConnected, this.addPeer);
    this.network.events.removeListener(NetworkEvent.peerDisconnected, this.removePeer);
    this.syncChain?.remove();
  }

  state(): BackfillSyncState {
    if (this.syncChain?.isSyncing && this.syncChain?.target) {
      return {status: BackfillSyncStatus.Syncing, target: this.syncChain.target};
    }
    return {status: BackfillSyncStatus.Idle};
  }

  private async update(): Promise<void> {
    const oldestStoredBlock = await this.db.blockArchive.firstValue();
    if (!oldestStoredBlock) {
      //no blocks in db, somethings wrong
      return;
    }
    const oldestStoredBlockSlot = oldestStoredBlock.message.slot;
    const oldestRequiredEpoch = Math.max(
      GENESIS_EPOCH,
      this.chain.clock.currentEpoch - getMinEpochForBlockRequests(this.config)
    );
    const oldestSlotRequired = computeStartSlotAtEpoch(this.config, oldestRequiredEpoch);
    if (oldestSlotRequired >= oldestStoredBlockSlot) {
      this.close();
    } else {
      this.syncChain?.startSyncing(oldestRequiredEpoch);
    }
  }

  private async addPeer(peerId: PeerId, peerStatus: phase0.Status): Promise<void> {
    //Could be caveat if you start from genesis, than stop and continue from WS state
    // Currently we are relying on block archive prune to delete old blocks after which this is going to work
    const oldestStoredBlock = await this.db.blockArchive.firstValue();
    if (!oldestStoredBlock) {
      //no blocks in db, somethings wrong
      return;
    }
    const oldestStoredBlockSlot = oldestStoredBlock.message.slot;
    const oldestRequiredEpoch = Math.max(
      GENESIS_EPOCH,
      this.chain.clock.currentEpoch - getMinEpochForBlockRequests(this.config)
    );
    const oldestSlotRequired = computeStartSlotAtEpoch(this.config, oldestRequiredEpoch);
    if (oldestSlotRequired >= oldestStoredBlockSlot) {
      return;
    }
    if (peerStatus.headSlot > oldestSlotRequired) {
      this.addPeerOrCreateChain(
        computeEpochAtSlot(this.config, oldestSlotRequired),
        {
          slot: oldestStoredBlockSlot,
          root: this.config.getForkTypes(oldestStoredBlockSlot).BeaconBlock.hashTreeRoot(oldestStoredBlock.message),
        },
        peerId
      );
    }
  }

  private addPeerOrCreateChain(startEpoch: Epoch, target: ChainTarget, peer: PeerId): void {
    if (!this.syncChain) {
      this.syncChain = new SyncChain(
        startEpoch,
        RangeSyncType.Finalized,
        {
          downloadBeaconBlocksByRange: this.downloadBeaconBlocksByRange,
          reportPeer: this.reportPeer,
          onEnd: this.onSyncChainEnd,
          processChainSegment: this.processChainSegment,
        },
        {config: this.config, logger: this.logger},
        this.opts
      );
      this.logger.verbose("New syncChain", {syncType: "backfill sync"});
    }
    this.syncChain.addPeer(peer, target);
  }

  /**
   * Remove this peer from all sync chains
   */
  private removePeer(peerId: PeerId): void {
    this.syncChain?.removePeer(peerId);
  }

  /** Convenience method for `SyncChain` */
  private processChainSegment: SyncChainFns["processChainSegment"] = async (blocks) => {
    const state = await this.chain.getHeadStateAtCurrentEpoch();
    verifyBlocks(this.config, state, blocks);
    await this.db.blockArchive.batchPut(blocks.map((b) => ({key: b.message.slot, value: b})));
  };

  /** Convenience method for `SyncChain` */
  private downloadBeaconBlocksByRange: SyncChainFns["downloadBeaconBlocksByRange"] = async (peerId, request) => {
    return await this.network.reqResp.beaconBlocksByRange(peerId, request);
  };

  /** Convenience method for `SyncChain` */
  private reportPeer: SyncChainFns["reportPeer"] = (peer, action, actionName) => {
    this.network.peerRpcScores.applyAction(peer, action, actionName);
  };

  /** Convenience method for `SyncChain` */
  private onSyncChainEnd: SyncChainFns["onEnd"] = (e) => {
    if (!e) {
      void this.update();
      this.emit(BackfillSyncEvent.completedChain);
    }
  };
}
