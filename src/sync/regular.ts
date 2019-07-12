/**
 * @module sync
 */

import {hashTreeRoot} from "@chainsafe/ssz";

import {BeaconBlock, Attestation} from "../types";
import {BLOCK_TOPIC, ATTESTATION_TOPIC} from "../constants";
import {IBeaconConfig} from "../config";
import {IBeaconDb} from "../db";
import {IBeaconChain} from "../chain";
import {INetwork} from "../network";
import {OpPool} from "../opPool";
import {ILogger} from "../logger";


export class RegularSync {
  private config: IBeaconConfig;
  private db: IBeaconDb;
  private chain: IBeaconChain;
  private network: INetwork;
  private opPool: OpPool;
  private logger: ILogger;

  public constructor(opts, {config, db, chain, network, opPool, logger}) {
    this.config = config;
    this.db = db;
    this.chain = chain;
    this.network = network;
    this.opPool = opPool;
    this.logger = logger;
  }

  public async receiveBlock(block: BeaconBlock): Promise<void> {
    // TODO: skip block if its a known bad block
    // skip block if it already exists
    const root = hashTreeRoot(block, this.config.types.BeaconBlock);
    if (!await this.db.hasBlock(root)) {
      await this.chain.receiveBlock(block);
    }
  }

  public async receiveAttestation(attestation: Attestation): Promise<void> {
    // skip attestation if it already exists
    const root = hashTreeRoot(attestation, this.config.types.Attestation);
    if (await this.db.hasAttestation(root)) {
      return;
    }
    // skip attestation if its too old
    const state = await this.db.getLatestState();
    if (attestation.data.targetEpoch < state.finalizedEpoch) {
      return;
    }
    // send attestation on to other modules
    await Promise.all([
      this.opPool.receiveAttestation(attestation),
      this.chain.receiveAttestation(attestation),
    ]);
  }

  public async start(): Promise<void> {
    this.network.subscribeToBlocks();
    this.network.subscribeToAttestations();
    this.network.on(BLOCK_TOPIC, this.receiveBlock.bind(this));
    this.network.on(ATTESTATION_TOPIC, this.receiveAttestation.bind(this));
    this.chain.on('processedBlock', this.network.publishBlock.bind(this.network));
    this.chain.on('processedAttestation', this.network.publishAttestation.bind(this.network));
  }
  public async stop(): Promise<void> {
    this.network.unsubscribeToBlocks();
    this.network.unsubscribeToAttestations();
    this.network.removeListener(BLOCK_TOPIC, this.receiveBlock.bind(this));
    this.network.removeListener(ATTESTATION_TOPIC, this.receiveAttestation.bind(this));
    this.chain.removeListener('processedBlock', this.network.publishBlock.bind(this.network));
    this.chain.removeListener('processedAttestation', this.network.publishAttestation.bind(this.network));
  }
}
