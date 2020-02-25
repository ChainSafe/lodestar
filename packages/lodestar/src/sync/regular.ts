/**
 * @module sync
 */

import {toHexString} from "@chainsafe/ssz";
import {
  AggregateAndProof,
  Attestation,
  AttesterSlashing,
  Checkpoint,
  CommitteeIndex,
  ProposerSlashing,
  Root,
  SignedBeaconBlock,
  SignedVoluntaryExit,
  Slot,
} from "@chainsafe/lodestar-types";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from  "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconDb} from "../db";
import {IBeaconChain} from "../chain";
import {INetwork} from "../network";
import {OpPool} from "../opPool";
import {ISyncModules} from "./index";
import {ISyncOptions} from "./options";
import {GossipEvent} from "../network/gossip/constants";
import {AttestationCollector} from "./subnet/attestation-collector";

export type IRegularSyncModules = Pick<ISyncModules, "config"|"db"|"chain"|"opPool"|"network"|"logger">;

export class RegularSync {
  private config: IBeaconConfig;
  private db: IBeaconDb;
  private chain: IBeaconChain;
  private network: INetwork;
  private attestationCollector: AttestationCollector;
  private opPool: OpPool;
  private logger: ILogger;

  public constructor(opts: Partial<ISyncOptions>, modules: IRegularSyncModules) {
    this.config = modules.config;
    this.db = modules.db;
    this.chain = modules.chain;
    this.network = modules.network;
    this.opPool = modules.opPool;
    this.logger = modules.logger;
    this.attestationCollector = new AttestationCollector(
      this.config,
      {chain: this.chain, network: this.network, opPool: this.opPool}
    );
  }

  public async start(): Promise<void> {
    this.logger.verbose("regular sync start");
    await this.attestationCollector.start();
    this.network.gossip.subscribeToBlock(this.receiveBlock);
    this.network.gossip.subscribeToAggregateAndProof(this.receiveAggregateAndProof);
    // For interop only, will be removed prior to mainnet
    this.network.gossip.subscribeToAttestation(this.receiveAttestation);
    this.network.gossip.subscribeToVoluntaryExit(this.receiveVoluntaryExit);
    this.network.gossip.subscribeToProposerSlashing(this.receiveProposerSlashing);
    this.network.gossip.subscribeToAttesterSlashing(this.receiveAttesterSlashing);
    this.chain.on("processedBlock", this.onProcessedBlock);
    this.chain.on("processedAttestation", this.onProcessedAttestation);
    this.chain.on("unknownBlockRoot", this.onUnknownBlockRoot);
    this.chain.on("finalizedCheckpoint", this.onFinalizedCheckpoint);
  }

  public async stop(): Promise<void> {
    this.logger.verbose("regular sync stop");
    await this.attestationCollector.stop();
    this.network.gossip.unsubscribe(GossipEvent.BLOCK, this.receiveBlock);
    this.network.gossip.unsubscribe(GossipEvent.AGGREGATE_AND_PROOF, this.receiveAggregateAndProof);
    this.network.gossip.unsubscribe(GossipEvent.ATTESTATION, this.receiveAttestation);
    this.network.gossip.unsubscribe(GossipEvent.VOLUNTARY_EXIT, this.receiveVoluntaryExit);
    this.network.gossip.unsubscribe(GossipEvent.PROPOSER_SLASHING, this.receiveProposerSlashing);
    this.network.gossip.unsubscribe(GossipEvent.ATTESTER_SLASHING, this.receiveAttesterSlashing);
    this.chain.removeListener("processedBlock", this.onProcessedBlock);
    this.chain.removeListener("processedAttestation", this.onProcessedAttestation);
    this.chain.removeListener("unknownBlockRoot", this.onUnknownBlockRoot);
    this.chain.removeListener("finalizedCheckpoint", this.onFinalizedCheckpoint);
  }

  public receiveBlock = async (signedBlock: SignedBeaconBlock): Promise<void> => {
    await this.chain.receiveBlock(signedBlock);
  };

  public receiveAggregateAndProof = async (aggregate: AggregateAndProof): Promise<void> => {
    await this.opPool.aggregateAndProofs.receive(aggregate);
  };

  public receiveAttestation = async (attestation: Attestation): Promise<void> => {
    // send attestation on to other modules
    await this.opPool.attestations.receive(attestation);
  };

  public receiveVoluntaryExit = async (voluntaryExit: SignedVoluntaryExit): Promise<void> => {
    await this.opPool.voluntaryExits.receive(voluntaryExit);
  };

  public receiveProposerSlashing = async (proposerSlashing: ProposerSlashing): Promise<void> => {
    await this.opPool.proposerSlashings.receive(proposerSlashing);
  };

  public receiveAttesterSlashing = async (attesterSlashing: AttesterSlashing): Promise<void> => {
    await this.opPool.attesterSlashings.receive(attesterSlashing);
  };

  public collectAttestations(slot: Slot, committeeIndex: CommitteeIndex): void {
    this.attestationCollector.subscribeToCommitteeAttestations(slot, committeeIndex);
  }

  private onProcessedBlock = (signedBlock: SignedBeaconBlock): void => {
    this.network.gossip.publishBlock(signedBlock);
  };

  private onProcessedAttestation = (attestation: Attestation): void => {
    this.network.gossip.publishCommiteeAttestation(attestation);
  };

  private onUnknownBlockRoot = async (root: Root): Promise<void> => {
    const hexRoot = toHexString(root);
    for (const peer of this.network.getPeers()) {
      try {
        this.logger.verbose(`Attempting to fetch block ${hexRoot} from ${peer.id.toB58String()}`);
        const [block] = await this.network.reqResp.beaconBlocksByRoot(peer, [root]);
        await this.chain.receiveBlock(block);
        break;
      } catch (e) {
        this.logger.verbose(`Unable to fetch block ${hexRoot}: ${e}`);
      }
    }
  };

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private onFinalizedCheckpoint = async (checkpoint: Checkpoint): Promise<void> => {
    await this.opPool.attestations.removeOld(this.chain.latestState);
  };
}
