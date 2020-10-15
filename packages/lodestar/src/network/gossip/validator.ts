import {IGossipMessageValidator} from "./interface";
import {
  AggregateAndProof,
  Attestation,
  AttesterSlashing,
  ProposerSlashing,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  SignedVoluntaryExit,
} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "../../db";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IAttestationJob, IBeaconChain} from "../../chain";
import {ExtendedValidatorResult} from "./constants";
import {validateGossipAggregateAndProof, validateGossipAttestation, validateGossipBlock} from "./validation";
import {BlockErrorCode} from "../../chain/errors/blockError";
import {IBlockJob} from "../../chain";
import {AttestationErrorCode} from "../../chain/errors/attestationError";
import {AttesterSlashingErrorCode} from "../../chain/errors/attesterSlashingError";
import {validateGossipAttesterSlashing} from "./validation/attesterSlashing";
import {ProposerSlashingErrorCode} from "../../chain/errors/proposerSlahingError";
import {validateGossipProposerSlashing} from "./validation/proposerSlashing";
import {validateGossipVoluntaryExit} from "./validation/voluntaryExit";

/* eslint-disable @typescript-eslint/interface-name-prefix */
interface GossipMessageValidatorModules {
  chain: IBeaconChain;
  db: IBeaconDb;
  config: IBeaconConfig;
  logger: ILogger;
}

export class GossipMessageValidator implements IGossipMessageValidator {
  private readonly chain: IBeaconChain;
  private readonly db: IBeaconDb;
  private readonly config: IBeaconConfig;
  private readonly logger: ILogger;

  public constructor({chain, db, config, logger}: GossipMessageValidatorModules) {
    this.chain = chain;
    this.db = db;
    this.config = config;
    this.logger = logger;
  }

  async updateAttestationSeenCaches(aggregateAndProof: AggregateAndProof): Promise<void> {
    await Promise.all([
      this.db.aggregateAndProof.add(aggregateAndProof),
      this.db.seenAttestationCache.addAggregateAndProof(aggregateAndProof),
    ]);
  }

  public isValidIncomingBlock = async (signedBlock: SignedBeaconBlock): Promise<ExtendedValidatorResult> => {
    try {
      const blockJob = {
        signedBlock: signedBlock,
        trusted: false,
        reprocess: false,
      } as IBlockJob;
      await validateGossipBlock(this.config, this.chain, this.db, this.logger, blockJob);
    } catch (e) {
      this.logger.error("Error while validating gossip block", e);
      const blockIgnoreCodes = [
        BlockErrorCode.ERR_FUTURE_SLOT,
        BlockErrorCode.ERR_WOULD_REVERT_FINALIZED_SLOT,
        BlockErrorCode.ERR_REPEAT_PROPOSAL,
        BlockErrorCode.ERR_PARENT_UNKNOWN,
      ];
      const blockRejectCodes = [
        BlockErrorCode.ERR_PROPOSAL_SIGNATURE_INVALID,
        BlockErrorCode.ERR_INCORRECT_PROPOSER,
        BlockErrorCode.ERR_KNOWN_BAD_BLOCK,
      ];
      if (blockIgnoreCodes.includes(e.code)) {
        this.logger.warn("Ignoring gossip block", e.toObject());
        return ExtendedValidatorResult.ignore;
      } else if (blockRejectCodes.includes(e.code)) {
        this.logger.warn("Rejecting gossip block", e.toObject());
        return ExtendedValidatorResult.reject;
      }
    }
    return ExtendedValidatorResult.accept;
  };

  public isValidIncomingCommitteeAttestation = async (
    attestation: Attestation,
    subnet: number
  ): Promise<ExtendedValidatorResult> => {
    try {
      const attestationJob = {
        attestation,
        validSignature: false,
      } as IAttestationJob;
      await validateGossipAttestation(this.config, this.chain, this.db, this.logger, attestationJob, subnet);
    } catch (e) {
      this.logger.error("Error while validating gossip attestation", e);
      const attestationRejectCodes = [
        AttestationErrorCode.ERR_COMMITTEE_INDEX_OUT_OF_RANGE,
        AttestationErrorCode.ERR_INVALID_SUBNET_ID,
        AttestationErrorCode.ERR_BAD_TARGET_EPOCH,
        AttestationErrorCode.ERR_NOT_EXACTLY_ONE_AGGREGATION_BIT_SET,
        AttestationErrorCode.ERR_WRONG_NUMBER_OF_AGGREGATION_BITS,
        AttestationErrorCode.ERR_INVALID_SIGNATURE, // TODO: where is this being checked?
        AttestationErrorCode.ERR_KNOWN_BAD_BLOCK,
        AttestationErrorCode.ERR_FINALIZED_CHECKPOINT_NOT_AN_ANCESTOR_OF_ROOT,
        AttestationErrorCode.ERR_TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK,
        AttestationErrorCode.ERR_INVALID_INDEXED_ATTESTATION,
      ];
      const attestationIgnoreCodes = [
        AttestationErrorCode.ERR_INVALID_SLOT_TIME,
        AttestationErrorCode.ERR_ATTESTATION_ALREADY_KNOWN,
        AttestationErrorCode.ERR_UNKNOWN_BEACON_BLOCK_ROOT,
        AttestationErrorCode.ERR_MISSING_ATTESTATION_PRESTATE,
      ];
      if (attestationRejectCodes.includes(e.code)) {
        this.logger.warn("Rejecting gossip attestation", e.toObject());
        return ExtendedValidatorResult.reject;
      } else if (attestationIgnoreCodes.includes(e.code)) {
        this.logger.warn("Ignoring gossip attestation", e.toObject());
        return ExtendedValidatorResult.ignore;
      }
    }
    return ExtendedValidatorResult.accept;
  };

  public isValidIncomingAggregateAndProof = async (
    signedAggregationAndProof: SignedAggregateAndProof
  ): Promise<ExtendedValidatorResult> => {
    try {
      const attestationJob = {
        attestation: signedAggregationAndProof.message.aggregate,
        validSignature: false,
      } as IAttestationJob;
      await validateGossipAggregateAndProof(
        this.config,
        this.chain,
        this.db,
        this.logger,
        signedAggregationAndProof,
        attestationJob
      );
      await this.updateAttestationSeenCaches(signedAggregationAndProof.message);
    } catch (e) {
      this.logger.error("Error while validating gossip aggregate and proof", e);
      const aggregateAndProofRejectCodes = [
        AttestationErrorCode.ERR_WRONG_NUMBER_OF_AGGREGATION_BITS,
        AttestationErrorCode.ERR_KNOWN_BAD_BLOCK,
        AttestationErrorCode.ERR_AGGREGATOR_NOT_IN_COMMITTEE,
        AttestationErrorCode.ERR_INVALID_SELECTION_PROOF,
        AttestationErrorCode.ERR_INVALID_SIGNATURE,
        AttestationErrorCode.ERR_INVALID_INDEXED_ATTESTATION,
        AttestationErrorCode.ERR_INVALID_AGGREGATOR,
      ];
      const aggregateAndProofIgnoreCodes = [
        AttestationErrorCode.ERR_INVALID_SLOT_TIME,
        AttestationErrorCode.ERR_AGGREGATE_ALREADY_KNOWN,
        AttestationErrorCode.ERR_MISSING_ATTESTATION_PRESTATE,
      ];
      if (aggregateAndProofRejectCodes.includes(e.code)) {
        this.logger.warn("Rejecting gossip aggregate & Proof", e.toObject());
        return ExtendedValidatorResult.reject;
      } else if (aggregateAndProofIgnoreCodes.includes(e.code)) {
        this.logger.warn("Ignoring gossip aggregate & Proof", e.toObject());
        return ExtendedValidatorResult.ignore;
      }
      await this.updateAttestationSeenCaches(signedAggregationAndProof.message);
    }
    return ExtendedValidatorResult.accept;
  };

  public isValidIncomingVoluntaryExit = async (
    voluntaryExit: SignedVoluntaryExit
  ): Promise<ExtendedValidatorResult> => {
    try {
      await validateGossipVoluntaryExit(this.config, this.chain, this.db, voluntaryExit);
    } catch (e) {
      this.logger.error("Error while validating gossip voluntary exit", e);
      if (e.code === ProposerSlashingErrorCode.ERR_SLASHING_ALREADY_EXISTS) {
        this.logger.warn("Ignoring gossip voluntary exit", e.toObject());
        return ExtendedValidatorResult.ignore;
      } else if (e.code === ProposerSlashingErrorCode.ERR_INVALID_SLASHING) {
        this.logger.warn("Rejecting gossip voluntary exit", e.toObject());
        return ExtendedValidatorResult.reject;
      }
    }
    return ExtendedValidatorResult.accept;
  };

  public isValidIncomingProposerSlashing = async (
    proposerSlashing: ProposerSlashing
  ): Promise<ExtendedValidatorResult> => {
    try {
      await validateGossipProposerSlashing(this.config, this.chain, this.db, proposerSlashing);
    } catch (e) {
      this.logger.error("Error while validating gossip proposer slashing", e);
      if (e.code === ProposerSlashingErrorCode.ERR_SLASHING_ALREADY_EXISTS) {
        this.logger.warn("Ignoring gossip proposer slashing", e.toObject());
        return ExtendedValidatorResult.ignore;
      } else if (e.code === ProposerSlashingErrorCode.ERR_INVALID_SLASHING) {
        this.logger.warn("Rejecting gossip proposer slashing", e.toObject());
        return ExtendedValidatorResult.reject;
      }
    }
    return ExtendedValidatorResult.accept;
  };

  public isValidIncomingAttesterSlashing = async (
    attesterSlashing: AttesterSlashing
  ): Promise<ExtendedValidatorResult> => {
    try {
      await validateGossipAttesterSlashing(this.config, this.chain, this.db, attesterSlashing);
    } catch (e) {
      this.logger.error("Error while validating gossip attester slashing", e);
      if (e.code === AttesterSlashingErrorCode.ERR_SLASHING_ALREADY_EXISTS) {
        this.logger.warn("Ignoring gossip attester slashing", e.toObject());
        return ExtendedValidatorResult.ignore;
      } else if (e.code === AttesterSlashingErrorCode.ERR_INVALID_SLASHING) {
        this.logger.warn("Rejecting gossip attester slashing", e.toObject());
        return ExtendedValidatorResult.reject;
      }
    }
    return ExtendedValidatorResult.accept;
  };
}
