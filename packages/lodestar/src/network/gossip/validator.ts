import {verify} from "@chainsafe/bls";
import {IGossipMessageValidator} from "./interface";
import {Attestation, BeaconBlock, AggregateAndProof, VoluntaryExit, ProposerSlashing, AttesterSlashing} 
  from "@chainsafe/eth2.0-types";
import {IBeaconDb} from "../../db";
import {getAttestationSubnet} from "./utils";
import {getCurrentSlot, isValidIndexedAttestation, getIndexedAttestation, isValidVoluntaryExit,
  isValidProposerSlashing, isValidAttesterSlashing, isValidBlockHeader, getAttestingIndices, 
  isAggregator, getDomain, computeEpochAtSlot} from "@chainsafe/eth2.0-state-transition";
import {IBeaconConfig} from "@chainsafe/eth2.0-config";
import {ATTESTATION_PROPAGATION_SLOT_RANGE} from "../../constants";
import {hashTreeRoot} from "@chainsafe/ssz";
import {ILogger} from "../../logger";
import {DomainType} from "@chainsafe/eth2.0-state-transition/lib/constants";

export class GossipMessageValidator implements IGossipMessageValidator {
  private db: IBeaconDb;
  private config: IBeaconConfig;
  private logger: ILogger;

  public constructor(db: IBeaconDb, config: IBeaconConfig, logger: ILogger) {
    this.db = db;
    this.config = config;
    this.logger = logger;
  }

  public async isValidIncomingBlock(block: BeaconBlock): Promise<boolean> {
    const root = hashTreeRoot(this.config.types.BeaconBlock, block);

    // skip block if its a known bad block
    if (await this.db.block.isBadBlock(root)) {
      this.logger.warn(`Received bad block, block root : ${root} `);
      return false;
    }

    // ignore if we have this block already
    if (await this.db.block.has(root as Buffer)) {
      return false;
    }

    const state = await this.db.state.getLatest();
    if (!isValidBlockHeader(this.config, state, block)) {
      return false;
    }

    return true;
  }

  public isUnaggregatedAttestation(attestation: Attestation): boolean {
    const aggregationBits = attestation.aggregationBits;
    let count = 0;
    for (let i = 0; i < aggregationBits.bitLength; i++) {
      if (aggregationBits.getBit(i)) {
        count++;
      }
    }
    if (count !== 1) {
      return false;
    }
    return true;
  }
  
  public async isValidIncomingCommitteeAttestation(attestation: Attestation, subnet: number): Promise<boolean> {
    if (String(subnet) !== getAttestationSubnet(attestation)) {
      return false;
    }
    // Make sure this is unaggregated attestation
    if (!this.isUnaggregatedAttestation(attestation)) {
      return false;
    }
    const blockRoot = attestation.data.beaconBlockRoot;
    if (!await this.db.block.has(blockRoot) || await this.db.block.isBadBlock(blockRoot)) {
      return false;
    }
    const state = await this.db.state.getLatest();
    const currentSlot = getCurrentSlot(this.config, state.genesisTime);
    if (!(attestation.data.slot + ATTESTATION_PROPAGATION_SLOT_RANGE >= currentSlot &&
      currentSlot >= attestation.data.slot)) {
      return false;
    }
    if(!isValidIndexedAttestation(this.config, state, getIndexedAttestation(this.config, state, attestation))) {
      return false;
    }
    return true;
  }

  public async isValidIncomingAggregateAndProof(aggregationAndProof: AggregateAndProof): Promise<boolean> {
    const root = hashTreeRoot(this.config.types.AggregateAndProof, aggregationAndProof);
    if (await this.db.aggregateAndProof.has(root as Buffer)) {
      return false;
    }
    const blockRoot = aggregationAndProof.aggregate.data.beaconBlockRoot;
    if (!await this.db.block.has(blockRoot) || await this.db.block.isBadBlock(blockRoot)) {
      return false;
    }
    const state = await this.db.state.getLatest();
    const currentSlot = getCurrentSlot(this.config, state.genesisTime);
    const slot = aggregationAndProof.aggregate.data.slot;
    if (!(slot + ATTESTATION_PROPAGATION_SLOT_RANGE >= currentSlot &&
      currentSlot >= slot)) {
      return false;
    }
    const attestorIndices = getAttestingIndices(this.config, state,
      aggregationAndProof.aggregate.data, aggregationAndProof.aggregate.aggregationBits);
    if (!attestorIndices.includes(aggregationAndProof.aggregatorIndex)) {
      return false;
    }
    if (!isAggregator(this.config, state, slot, aggregationAndProof.aggregatorIndex, 
      aggregationAndProof.selectionProof)) {
      return false;
    }
    const validatorPubKey = state.validators[aggregationAndProof.aggregatorIndex].pubkey;
    const domain = getDomain(this.config, state, DomainType.BEACON_ATTESTER, computeEpochAtSlot(this.config, slot));
    if (!verify(validatorPubKey,
      hashTreeRoot(this.config.types.Slot, slot),
      aggregationAndProof.selectionProof, 
      domain)) {
      return false;
    }
    const indexedAttestation = getIndexedAttestation(this.config, state, aggregationAndProof.aggregate);
    if (!isValidIndexedAttestation(this.config, state, indexedAttestation)) {
      return false;
    }
    return true;
  }

  public async isValidIncomingUnaggregatedAttestation(attestation: Attestation): Promise<boolean> {
    if (!this.isUnaggregatedAttestation(attestation)) {
      return false;
    }
    // skip attestation if it already exists
    const root = hashTreeRoot(this.config.types.Attestation, attestation);
    if (await this.db.attestation.has(root as Buffer)) {
      return false;
    }
    // skip attestation if its too old
    const state = await this.db.state.getLatest();
    if (attestation.data.target.epoch < state.finalizedCheckpoint.epoch) {
      return false;
    }
    return true;
  }

  public async isValidIncomingVoluntaryExit(voluntaryExit: VoluntaryExit): Promise<boolean> {
    // skip voluntary exit if it already exists
    const root = hashTreeRoot(this.config.types.VoluntaryExit, voluntaryExit);
    if (await this.db.voluntaryExit.has(root as Buffer)) {
      return false;
    }
    const state = await this.db.state.getLatest();
    if(!isValidVoluntaryExit(this.config, state, voluntaryExit)) {
      return false;
    }
    return true;
  }

  public async isValidIncomingProposerSlashing(proposerSlashing: ProposerSlashing): Promise<boolean> {
    // skip proposer slashing if it already exists
    const root = hashTreeRoot(this.config.types.ProposerSlashing, proposerSlashing);
    if (await this.db.proposerSlashing.has(root as Buffer)) {
      return false;
    }
    const state = await this.db.state.getLatest();
    if (!isValidProposerSlashing(this.config, state, proposerSlashing)) {
      return false;
    }
    return true;
  }

  public async isValidIncomingAttesterSlashing(attesterSlashing: AttesterSlashing): Promise<boolean> {
    // skip attester slashing if it already exists
    const root = hashTreeRoot(this.config.types.AttesterSlashing, attesterSlashing);
    if (await this.db.attesterSlashing.has(root as Buffer)) {
      return false;
    }
    const state = await this.db.state.getLatest();
    if (!isValidAttesterSlashing(this.config, state, attesterSlashing)) {
      return false;
    }
    return true;
  }
}
