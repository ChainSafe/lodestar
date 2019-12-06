/**
 * @module sync
 */

import {hashTreeRoot} from "@chainsafe/ssz";

import {Attestation, BeaconBlock, Checkpoint, Hash, VoluntaryExit, ProposerSlashing, AttesterSlashing,
  AggregateAndProof} from "@chainsafe/eth2.0-types";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {IBeaconDb} from "../db";
import {IBeaconChain} from "../chain";
import {INetwork} from "../network";
import {OpPool} from "../opPool";
import {ILogger} from "../logger";
import {ISyncModules} from "./index";
import {ISyncOptions} from "./options";
import {GossipEvent} from "../network/gossip/constants";
import {isValidAttesterSlashing, isValidProposerSlashing, isValidVoluntaryExit, getCurrentSlot, 
  isValidIndexedAttestation, getIndexedAttestation} from "@chainsafe/eth2.0-state-transition";
import {ATTESTATION_PROPAGATION_SLOT_RANGE} from "../constants";
import {getAttestationSubnet} from "../network/gossip/utils";

export type IRegularSyncModules = Pick<ISyncModules, "config"|"db"|"chain"|"opPool"|"network"|"logger">;

export class RegularSync {
  private config: IBeaconConfig;
  private db: IBeaconDb;
  private chain: IBeaconChain;
  private network: INetwork;
  private opPool: OpPool;
  private logger: ILogger;

  public constructor(opts: ISyncOptions, modules: IRegularSyncModules) {
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
    const root = hashTreeRoot(block, this.config.types.BeaconBlock);

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

  public receiveCommitteeAttestation = async (attestationSubnet: {attestation: Attestation; subnet: number}): 
  Promise<void> => {
    const attestation = attestationSubnet.attestation;
    const subnet = attestationSubnet.subnet;
    if (String(subnet) !== getAttestationSubnet(attestation)) {
      return;
    }
    // Make sure this is unaggregated attestation
    const aggregationBits = attestation.aggregationBits;
    let count = 0;
    for (let i = 0; i < aggregationBits.bitLength; i++) {
      if (aggregationBits.getBit(i)) {
        count++;
      }
    }
    if (count !== 1) {
      return;
    }
    if (await this.db.block.isBadBlock(attestation.data.beaconBlockRoot)) {
      return;
    }
    const state = await this.db.state.getLatest();
    const currentSlot = getCurrentSlot(this.config, state.genesisTime);
    if (!(attestation.data.slot + ATTESTATION_PROPAGATION_SLOT_RANGE >= currentSlot &&
      currentSlot >= attestation.data.slot)) {
      return;
    }
    if(!isValidIndexedAttestation(this.config, state, getIndexedAttestation(this.config, state, attestation))) {
      return;
    }
    // to see if we need special process for these unaggregated attestations
    // not in the spec atm
    // send attestation on to other modules
    await Promise.all([
      this.opPool.attestations.receive(attestation),
      this.chain.receiveAttestation(attestation),
    ]);
  };

  public receiveAggregateAndProof = async (aggregation: AggregateAndProof): Promise<void> => {
    // a place holder for mainnet
    // this is for aggregated attestattions
    this.logger.debug(aggregation);
  };

  public receiveAttestation = async (attestation: Attestation): Promise<void> => {
    // skip attestation if it already exists
    const root = hashTreeRoot(attestation, this.config.types.Attestation);
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

  public receiveVoluntaryExit = async (voluntaryExit: VoluntaryExit): Promise<void> => {
    // skip voluntary exit if it already exists
    const root = hashTreeRoot(voluntaryExit, this.config.types.VoluntaryExit);
    if (await this.db.voluntaryExit.has(root as Buffer)) {
      return;
    }
    const state = await this.db.state.getLatest();
    if(!isValidVoluntaryExit(this.config, state, voluntaryExit)) {
      return;
    }
    await this.opPool.voluntaryExits.receive(voluntaryExit);
  };

  public receiveProposerSlashing = async (proposerSlashing: ProposerSlashing): Promise<void> => {
    // skip proposer slashing if it already exists
    const root = hashTreeRoot(proposerSlashing, this.config.types.ProposerSlashing);
    if (await this.db.proposerSlashing.has(root as Buffer)) {
      return;
    }
    const state = await this.db.state.getLatest();
    if (!isValidProposerSlashing(this.config, state, proposerSlashing)) {
      return;
    }
    await this.opPool.proposerSlashings.receive(proposerSlashing);
  };

  public receiveAttesterSlashing = async (attesterSlashing: AttesterSlashing): Promise<void> => {
    // skip attester slashing if it already exists
    const root = hashTreeRoot(attesterSlashing, this.config.types.AttesterSlashing);
    if (await this.db.attesterSlashing.has(root as Buffer)) {
      return;
    }
    const state = await this.db.state.getLatest();
    if (!isValidAttesterSlashing(this.config, state, attesterSlashing)) {
      return;
    }
    await this.opPool.attesterSlashings.receive(attesterSlashing);
  };

  private onProcessedBlock = (block: BeaconBlock): void => {
    this.network.gossip.publishBlock(block);
  };

  private onProcessedAttestation = (attestation: Attestation): void => {
    this.network.gossip.publishCommiteeAttestation(attestation);
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
