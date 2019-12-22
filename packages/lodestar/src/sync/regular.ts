/**
 * @module sync
 */

import {Attestation, BeaconBlock, Checkpoint, VoluntaryExit, ProposerSlashing, AttesterSlashing,
  AggregateAndProof,
  Root} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconDb} from "../db";
import {IBeaconChain} from "../chain";
import {INetwork} from "../network";
import {OpPool} from "../opPool";
import {ILogger} from "../logger";
import {ISyncModules} from "./index";
import {ISyncOptions} from "./options";
import {GossipEvent} from "../network/gossip/constants";

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
    this.network.gossip.on(GossipEvent.BLOCK, this.receiveBlock);
    this.network.gossip.on(GossipEvent.ATTESTATION_SUBNET, this.receiveCommitteeAttestation);
    this.network.gossip.on(GossipEvent.AGGREGATE_AND_PROOF, this.receiveAggregateAndProof);
    // For interop only, will be removed prior to mainnet
    this.network.gossip.on(GossipEvent.ATTESTATION, this.receiveAttestation);
    this.network.gossip.on(GossipEvent.VOLUNTARY_EXIT, this.receiveVoluntaryExit);
    this.network.gossip.on(GossipEvent.PROPOSER_SLASHING, this.receiveProposerSlashing);
    this.network.gossip.on(GossipEvent.ATTESTER_SLASHING, this.receiveAttesterSlashing);
    this.chain.on("processedBlock", this.onProcessedBlock);
    this.chain.on("processedAttestation", this.onProcessedAttestation);
    this.chain.on("unknownBlockRoot", this.onUnknownBlockRoot);
    this.chain.on("finalizedCheckpoint", this.onFinalizedCheckpoint);
  }

  public async stop(): Promise<void> {
    this.logger.verbose("regular sync stop");
    this.network.gossip.removeListener(GossipEvent.BLOCK, this.receiveBlock);
    this.network.gossip.removeListener(GossipEvent.ATTESTATION_SUBNET, this.receiveCommitteeAttestation);
    this.network.gossip.removeListener(GossipEvent.AGGREGATE_AND_PROOF, this.receiveAggregateAndProof);
    this.network.gossip.removeListener(GossipEvent.ATTESTATION, this.receiveAttestation);
    this.network.gossip.removeListener(GossipEvent.VOLUNTARY_EXIT, this.receiveVoluntaryExit);
    this.network.gossip.removeListener(GossipEvent.PROPOSER_SLASHING, this.receiveProposerSlashing);
    this.network.gossip.removeListener(GossipEvent.ATTESTER_SLASHING, this.receiveAttesterSlashing);
    this.chain.removeListener("processedBlock", this.onProcessedBlock);
    this.chain.removeListener("processedAttestation", this.onProcessedAttestation);
    this.chain.removeListener("unknownBlockRoot", this.onUnknownBlockRoot);
    this.chain.removeListener("finalizedCheckpoint", this.onFinalizedCheckpoint);
  }

  public receiveBlock = async (block: BeaconBlock): Promise<void> => {
    await this.chain.receiveBlock(block);
  };

  public receiveCommitteeAttestation = async (attestationSubnet: {attestation: Attestation; subnet: number}): 
  Promise<void> => {
    const attestation = attestationSubnet.attestation;
    
    // to see if we need special process for these unaggregated attestations
    // not in the spec atm
    // send attestation on to other modules
    await Promise.all([
      this.opPool.attestations.receive(attestation),
      this.chain.receiveAttestation(attestation),
    ]);
  };

  public receiveAggregateAndProof = async (aggregate: AggregateAndProof): Promise<void> => {
    await this.opPool.aggregateAndProofs.receive(aggregate);
  };

  public receiveAttestation = async (attestation: Attestation): Promise<void> => {
    // send attestation on to other modules
    await Promise.all([
      this.opPool.attestations.receive(attestation),
      this.chain.receiveAttestation(attestation),
    ]);
  };

  public receiveVoluntaryExit = async (voluntaryExit: VoluntaryExit): Promise<void> => {
    await this.opPool.voluntaryExits.receive(voluntaryExit);
  };

  public receiveProposerSlashing = async (proposerSlashing: ProposerSlashing): Promise<void> => {
    await this.opPool.proposerSlashings.receive(proposerSlashing);
  };

  public receiveAttesterSlashing = async (attesterSlashing: AttesterSlashing): Promise<void> => {
    await this.opPool.attesterSlashings.receive(attesterSlashing);
  };

  private onProcessedBlock = (block: BeaconBlock): void => {
    this.network.gossip.publishBlock(block);
  };

  private onProcessedAttestation = (attestation: Attestation): void => {
    this.network.gossip.publishCommiteeAttestation(attestation);
  };

  private onUnknownBlockRoot = async (root: Root): Promise<void> => {
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
