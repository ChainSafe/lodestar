/**
 * @module sync
 */

import {hashTreeRoot} from "@chainsafe/ssz";

import {BeaconBlock, Attestation, Hash, Checkpoint} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {ATTESTATION_TOPIC, BLOCK_TOPIC} from "../constants";
import {IBeaconDb} from "../db";
import {IBeaconChain} from "../chain";
import {INetwork} from "../network";
import {OpPool} from "../opPool";
import {ILogger} from "../logger";
import {ISyncModules} from "./index";
import {ISyncOptions} from "./options";

export type IRegularSyncModules = Pick<ISyncModules, "config"|"db"|"chain"|"opPool"|"network"|"logger">;

export class RegularSync {
  private config: IBeaconConfig;
  private db: IBeaconDb;
  private chain: IBeaconChain;
  private network: INetwork;
  private opPool: OpPool;
  private logger: ILogger;

  public constructor(opts: Partial<ISyncOptions>, modules: IRegularSyncModules) {
    this.config = modules.config;
    this.db = modules.db;
    this.chain = modules.chain;
    this.network = modules.network;
    this.opPool = modules.opPool;
    this.logger = modules.logger;
  }

  public async start(): Promise<void> {
    this.logger.verbose("regular sync start");
    this.network.gossip.subscribeToBlocks();
    this.network.gossip.subscribeToAttestations();
    this.network.gossip.on(BLOCK_TOPIC, this.receiveBlock);
    this.network.gossip.on(ATTESTATION_TOPIC, this.receiveAttestation);
    this.chain.on("processedBlock", this.onProcessedBlock);
    this.chain.on("processedAttestation", this.onProcessedAttestation);
    this.chain.on("unknownBlockRoot", this.onUnknownBlockRoot);
    this.chain.on("finalizedCheckpoint", this.onFinalizedCheckpoint);
  }

  public async stop(): Promise<void> {
    this.logger.verbose("regular sync stop");
    this.network.gossip.unsubscribeToBlocks();
    this.network.gossip.unsubscribeToAttestations();
    this.network.gossip.removeListener(BLOCK_TOPIC, this.receiveBlock);
    this.network.gossip.removeListener(ATTESTATION_TOPIC, this.receiveAttestation);
    this.chain.removeListener("processedBlock", this.onProcessedBlock);
    this.chain.removeListener("processedAttestation", this.onProcessedAttestation);
    this.chain.removeListener("unknownBlockRoot", this.onUnknownBlockRoot);
    this.chain.removeListener("finalizedCheckpoint", this.onFinalizedCheckpoint);
  }

  public receiveBlock = async (block: BeaconBlock): Promise<void> => {
    const root = hashTreeRoot(this.config.types.BeaconBlock, block);

    // skip block if its a known bad block
    if (await this.db.block.isBadBlock(root)) {
      this.logger.warn(`Received bad block, block root : ${root} `);
      return;
    }
    // skip block if it already exists
    if (!await this.db.block.has(root as Buffer)) {
      await this.chain.receiveBlock(block);
    }
  };

  public receiveAttestation = async (attestation: Attestation): Promise<void> => {
    // skip attestation if it already exists
    const root = hashTreeRoot(this.config.types.Attestation, attestation);
    if (await this.db.attestation.has(root as Buffer)) {
      return;
    }
    // skip attestation if its too old
    const state = await this.db.state.getLatest();
    if (attestation.data.target.epoch < state.finalizedCheckpoint.epoch) {
      return;
    }
    // send attestation on to other modules
    await Promise.all([
      this.opPool.attestations.receive(attestation),
      this.chain.receiveAttestation(attestation),
    ]);
  };

  private onProcessedBlock = (block: BeaconBlock): void => {
    this.network.gossip.publishBlock(block);
  };

  private onProcessedAttestation = (attestation: Attestation): void => {
    this.network.gossip.publishAttestation(attestation);
  };

  private onUnknownBlockRoot = async (root: Hash): Promise<void> => {
    for (const peer of this.network.getPeers()) {
      try {
        this.logger.verbose(`Attempting to fetch block ${root.toString("hex")} from ${peer.id.toB58String()}`);
        const [block] = await this.network.reqResp.beaconBlocksByRoot(peer, [root]);
        await this.chain.receiveBlock(block);
        break;
      } catch (e) {
        this.logger.verbose(`Unable to fetch block ${root.toString("hex")}: ${e}`);
      }
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private onFinalizedCheckpoint = async (checkpoint: Checkpoint): Promise<void> => {
    await this.opPool.attestations.removeOld(this.chain.latestState);
  };
}
