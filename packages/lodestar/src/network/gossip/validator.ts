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
      if (
        e.code === BlockErrorCode.ERR_FUTURE_SLOT ||
        e.code === BlockErrorCode.ERR_WOULD_REVERT_FINALIZED_SLOT ||
        e.code === BlockErrorCode.ERR_REPEAT_PROPOSAL ||
        e.code === BlockErrorCode.ERR_PARENT_UNKNOWN
      ) {
        this.logger.warn("Ignoring gossip block", e.toObject());
        return ExtendedValidatorResult.ignore;
      } else if (
        e.code === BlockErrorCode.ERR_PROPOSAL_SIGNATURE_INVALID ||
        e.code === BlockErrorCode.ERR_PRESTATE_MISSING ||
        e.code === BlockErrorCode.ERR_CHECKPOINT_NOT_AN_ANCESTOR_OF_BLOCK ||
        e.code === BlockErrorCode.ERR_INCORRECT_PROPOSER
      ) {
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
      if (
        e.code === AttestationErrorCode.ERR_COMMITTEE_INDEX_OUT_OF_RANGE ||
        e.code === AttestationErrorCode.ERR_INVALID_SUBNET_ID ||
        e.code === AttestationErrorCode.ERR_BAD_TARGET_EPOCH ||
        e.code === AttestationErrorCode.ERR_NOT_EXACTLY_ONE_AGGREGATION_BIT_SET ||
        e.code === AttestationErrorCode.ERR_WRONG_NUMBER_OF_AGGREGATION_BITS ||
        e.code === AttestationErrorCode.ERR_INVALID_SIGNATURE ||
        e.code === AttestationErrorCode.ERR_KNOWN_BAD_BLOCK ||
        e.code === AttestationErrorCode.ERR_FINALIZED_CHECKPOINT_NOT_AN_ANCESTOR_OF_ROOT ||
        e.code === AttestationErrorCode.ERR_TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK ||
        e.code === AttestationErrorCode.ERR_INVALID_INDEXED_ATTESTATION
      ) {
        this.logger.warn("Rejecting gossip attestation", e.toObject());
        return ExtendedValidatorResult.reject;
      } else if (
        e.code === AttestationErrorCode.ERR_SLOT_OUT_OF_RANGE ||
        e.code === AttestationErrorCode.ERR_ATTESTATION_ALREADY_KNOWN ||
        e.code === AttestationErrorCode.ERR_UNKNOWN_HEAD_BLOCK ||
        e.code === AttestationErrorCode.ERR_MISSING_ATTESTATION_PRESTATE
      ) {
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
      if (
        e.code === AttestationErrorCode.ERR_WRONG_NUMBER_OF_AGGREGATION_BITS ||
        e.code === AttestationErrorCode.ERR_KNOWN_BAD_BLOCK ||
        e.code === AttestationErrorCode.ERR_AGGREGATOR_NOT_IN_COMMITTEE ||
        e.code === AttestationErrorCode.ERR_INVALID_SELECTION_PROOF ||
        e.code === AttestationErrorCode.ERR_INVALID_SIGNATURE ||
        e.code === AttestationErrorCode.ERR_INVALID_INDEXED_ATTESTATION ||
        e.code === AttestationErrorCode.ERR_INVALID_AGGREGATOR
      ) {
        this.logger.warn("Rejecting gossip aggregate & Proof", e.toObject());
        return ExtendedValidatorResult.reject;
      } else if (
        e.code === AttestationErrorCode.ERR_SLOT_OUT_OF_RANGE ||
        e.code === AttestationErrorCode.ERR_AGGREGATE_ALREADY_KNOWN ||
        e.code === AttestationErrorCode.ERR_MISSING_ATTESTATION_PRESTATE
      ) {
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
