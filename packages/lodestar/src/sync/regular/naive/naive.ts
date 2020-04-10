import {IRegularSync, IRegularSyncModules} from "../interface";
import {INetwork} from "../../../network";
import {IBeaconChain} from "../../../chain";
import {getHighestCommonSlot, isValidChainOfBlocks} from "../../utils/sync";
import {IBeaconDb} from "../../../db/api";
import {OpPool} from "../../../opPool";
import {blockToHeader} from "@chainsafe/lodestar-beacon-state-transition";
import {getBlockRange} from "../../utils/blocks";
import {defaultOptions, IRegularSyncOptions} from "../options";
import deepmerge from "deepmerge";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {GossipEvent} from "../../../network/gossip/constants";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ReputationStore} from "../../IReputation";
import {AggregateAndProof, Root, SignedBeaconBlock, Slot} from "@chainsafe/lodestar-types";
import {AttestationCollector} from "../../utils/attestation-collector";
import {RoundRobinArray} from "../../utils/robin";

export class NaiveRegularSync implements IRegularSync {

  private readonly config: IBeaconConfig;

  private readonly db: IBeaconDb;

  private readonly opPool: OpPool;

  private readonly network: INetwork;

  private readonly chain: IBeaconChain;

  private readonly reps: ReputationStore;

  private readonly peers: PeerInfo[];

  private readonly logger: ILogger;

  private readonly attestationCollector: AttestationCollector;

  private readonly opts: IRegularSyncOptions;
  
  private targetSlot: Slot;

  constructor(options: Partial<IRegularSyncOptions>, modules: IRegularSyncModules) {
    this.config = modules.config;
    this.db = modules.db;
    this.opPool = modules.opPool;
    this.network = modules.network;
    this.chain = modules.chain;
    this.peers = modules.peers;
    this.reps = modules.reps;
    this.logger = modules.logger;
    this.opts = deepmerge(defaultOptions, options);
    this.attestationCollector = new AttestationCollector(
      this.config,
      {chain: this.chain, network: this.network, opPool: this.opPool}
    );
  }

  public async start(): Promise<void> {
    this.logger.info("Started regular syncing");
    this.chain.on("processedBlock", this.onProcessedBlock);
    await this.attestationCollector.start();
    this.logger.info("Started subscribing to gossip topics...");
    this.startGossiping();
    this.chain.on("unknownBlockRoot", this.onUnknownBlockRoot);
    if(!await this.syncUp()) {
      this.chain.removeListener("processedBlock", this.onProcessedBlock);
    }
  }

  public async stop(): Promise<void> {
    this.chain.removeListener("processedBlock", this.onProcessedBlock);
    this.stopGossiping();
    this.chain.removeListener("unknownBlockRoot", this.onUnknownBlockRoot);
    await this.attestationCollector.stop();
  }

  public collectAttestations(slot: number, committeeIndex: number): void {
    this.attestationCollector.subscribeToCommitteeAttestations(slot, committeeIndex);
  }

  private startGossiping(): void {
    const forkDigest = this.chain.currentForkDigest;
    this.network.gossip.subscribeToBlock(forkDigest, this.onBlock);
    this.network.gossip.subscribeToAggregateAndProof(forkDigest, this.onAggregatedAttestation);
    this.network.gossip.subscribeToAttesterSlashing(forkDigest, this.opPool.attesterSlashings.receive);
    this.network.gossip.subscribeToProposerSlashing(forkDigest, this.opPool.proposerSlashings.receive);
    this.network.gossip.subscribeToVoluntaryExit(forkDigest, this.opPool.voluntaryExits.receive);
  }

  private stopGossiping(): void {
    const forkDigest = this.chain.currentForkDigest;
    this.network.gossip.unsubscribe(forkDigest, GossipEvent.BLOCK, this.onBlock);
    this.network.gossip.unsubscribe(forkDigest, GossipEvent.AGGREGATE_AND_PROOF, this.onAggregatedAttestation);
    this.network.gossip.unsubscribe(forkDigest, GossipEvent.ATTESTER_SLASHING, this.opPool.attesterSlashings.receive);
    this.network.gossip.unsubscribe(forkDigest, GossipEvent.PROPOSER_SLASHING, this.opPool.proposerSlashings.receive);
    this.network.gossip.unsubscribe(forkDigest, GossipEvent.VOLUNTARY_EXIT, this.opPool.voluntaryExits.receive);
  }

  /**
     * @return false if it's already synced up, true if submitted blocks for chain processing
     */
  private async syncUp(): Promise<boolean> {
    const latestState = await this.chain.getHeadState();
    const currentSlot = latestState.slot;
    const highestCommonSlot = getHighestCommonSlot(
      Array.from(this.peers).map((peer) => this.reps.getFromPeerInfo(peer))
    );
    if (currentSlot >= highestCommonSlot) {
      this.logger.info("Chain already synced!");
      return false;
    }
    this.targetSlot = currentSlot + Math.min(highestCommonSlot, this.config.params.SLOTS_PER_EPOCH);
    this.logger.info(`Syncing slots ${currentSlot + 1}...${this.targetSlot}`);
    const blocks = await getBlockRange(
      this.network.reqResp,
      this.peers,
      {start: currentSlot + 1, end: this.targetSlot},
      this.opts.blockPerChunk
    );
    if(blocks.length > 0) {
      const startBlockHeader = blockToHeader(
        this.config,
        (await this.db.block.get(blocks[0].message.parentRoot.valueOf() as Uint8Array)).message
      );
      if(isValidChainOfBlocks(this.config, startBlockHeader, blocks)) {
        this.logger.info(`Processing blocks for slots ${currentSlot}...${this.targetSlot}`);
        blocks.forEach((block) => this.chain.receiveBlock(block, false));
      } else {
        this.logger.warn(`Received invalid chain  of blocks for slots ${currentSlot}...${this.targetSlot}`);
        this.syncUp();
      }
    } else {
      this.targetSlot++;
      this.syncUp();
    }
    return true;
  }

  private onProcessedBlock = async (block: SignedBeaconBlock): Promise<void> => {
    if (this.targetSlot > block.message.slot) {
      return;
    }
    //synced to target, try new targetg;
    if(await this.syncUp()) {

      this.logger.important("Synced up!");
    }
  };

  private onAggregatedAttestation = async (aggregate: AggregateAndProof): Promise<void> => {
    await this.chain.receiveAttestation(aggregate.aggregate);
  };

  private onBlock = async (block: SignedBeaconBlock): Promise<void> => {
    await this.chain.receiveBlock(block);
  };

  private onUnknownBlockRoot = async (root: Root): Promise<void> => {
    const peerBalancer = new RoundRobinArray(this.peers);
    let peer = peerBalancer.next();
    let block: SignedBeaconBlock;
    while (!block && peer) {
      block = (await this.network.reqResp.beaconBlocksByRoot(peer, [root]))[0];
      peer = peerBalancer.next();
    }
    if(block) {
      await this.chain.receiveBlock(block);
    }
  };
}