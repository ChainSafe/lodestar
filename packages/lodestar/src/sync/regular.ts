/**
 * @module sync
 */

import {hashTreeRoot} from "@chainsafe/ssz";

import {BeaconBlock, Attestation} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";

import {BLOCK_TOPIC, ATTESTATION_TOPIC} from "../constants";
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

  public receiveBlock = async (block: BeaconBlock): Promise<void> => {
    const root = hashTreeRoot(block, this.config.types.BeaconBlock);

    // skip block if its a known bad block
    if (await this.db.block.isBadBlock(root)) {
      this.logger.warn(`Received bad block, block root : ${root} `);
      return;
    }
    // skip block if it already exists
    if (!await this.db.block.has(root)) {
      await this.chain.receiveBlock(block);
    }
  };

  public receiveAttestation = async (attestation: Attestation): Promise<void> => {
    // skip attestation if it already exists
    const root = hashTreeRoot(attestation, this.config.types.Attestation);
    if (await this.db.attestation.has(root)) {
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

  public async start(): Promise<void> {
    this.network.gossip.subscribeToBlocks();
    this.network.gossip.subscribeToAttestations();
    this.network.gossip.on(BLOCK_TOPIC, this.receiveBlock);
    this.network.gossip.on(ATTESTATION_TOPIC, this.receiveAttestation);
    this.chain.on('processedBlock', this.onProcessedBlock);
    this.chain.on('processedAttestation', this.onProcessedAttestation);
  }

  public async stop(): Promise<void> {
    this.network.gossip.unsubscribeToBlocks();
    this.network.gossip.unsubscribeToAttestations();
    this.network.gossip.removeListener(BLOCK_TOPIC, this.receiveBlock);
    this.network.gossip.removeListener(ATTESTATION_TOPIC, this.receiveAttestation);
    this.chain.removeListener('processedBlock', this.onProcessedBlock);
    this.chain.removeListener('processedAttestation', this.onProcessedAttestation);
  }
}
