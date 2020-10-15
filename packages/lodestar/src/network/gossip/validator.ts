import {IGossipMessageValidator} from "./interface";
import {
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

  public isValidIncomingBlock = async (signedBlock: SignedBeaconBlock): Promise<ExtendedValidatorResult> => {
    try {
      const blockJob = {
        signedBlock: signedBlock,
        trusted: false,
        reprocess: false,
      } as IBlockJob;
      await validateGossipBlock(this.config, this.chain, this.db, this.logger, blockJob);
    } catch (e) {
      this.logger.error("Error while validating gossip block");
      switch (e.type.code) {
        case BlockErrorCode.ERR_FUTURE_SLOT:
        case BlockErrorCode.ERR_WOULD_REVERT_FINALIZED_SLOT:
        case BlockErrorCode.ERR_REPEAT_PROPOSAL:
        case BlockErrorCode.ERR_PARENT_UNKNOWN:
          this.logger.warn("Ignoring gossip block: ", e.type);
          return ExtendedValidatorResult.ignore;
        case BlockErrorCode.ERR_PROPOSAL_SIGNATURE_INVALID:
        case BlockErrorCode.ERR_INCORRECT_PROPOSER:
        case BlockErrorCode.ERR_KNOWN_BAD_BLOCK:
          this.logger.warn("Rejecting gossip block: ", e.type);
          return ExtendedValidatorResult.reject;
        default:
          break;
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
      this.logger.error("Error while validating gossip attestation");
      switch (e.type.code) {
        case AttestationErrorCode.ERR_COMMITTEE_INDEX_OUT_OF_RANGE:
        case AttestationErrorCode.ERR_INVALID_SUBNET_ID:
        case AttestationErrorCode.ERR_BAD_TARGET_EPOCH:
        case AttestationErrorCode.ERR_NOT_EXACTLY_ONE_AGGREGATION_BIT_SET:
        case AttestationErrorCode.ERR_WRONG_NUMBER_OF_AGGREGATION_BITS:
        case AttestationErrorCode.ERR_INVALID_SIGNATURE: // TODO: where is this being checked?
        case AttestationErrorCode.ERR_KNOWN_BAD_BLOCK:
        case AttestationErrorCode.ERR_FINALIZED_CHECKPOINT_NOT_AN_ANCESTOR_OF_ROOT:
        case AttestationErrorCode.ERR_TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK:
        case AttestationErrorCode.ERR_INVALID_INDEXED_ATTESTATION:
          this.logger.warn("Rejecting gossip attestation: ", e.type);
          return ExtendedValidatorResult.reject;
        case AttestationErrorCode.ERR_INVALID_SLOT_TIME:
        case AttestationErrorCode.ERR_ATTESTATION_ALREADY_KNOWN:
        case AttestationErrorCode.ERR_UNKNOWN_BEACON_BLOCK_ROOT:
        case AttestationErrorCode.ERR_MISSING_ATTESTATION_PRESTATE:
          this.logger.warn("Ignoring gossip attestation: ", e.type);
          return ExtendedValidatorResult.ignore;
        default:
          break;
      }
    }
    return ExtendedValidatorResult.accept;
  };

  public isValidIncomingAggregateAndProof = async (
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<ExtendedValidatorResult> => {
    try {
      const attestationJob = {
        attestation: signedAggregateAndProof.message.aggregate,
        validSignature: false,
      } as IAttestationJob;
      await validateGossipAggregateAndProof(
        this.config,
        this.chain,
        this.db,
        this.logger,
        signedAggregateAndProof,
        attestationJob
      );
    } catch (e) {
      this.logger.error("Error while validating gossip aggregate and proof");
      switch (e.type.code) {
        case AttestationErrorCode.ERR_WRONG_NUMBER_OF_AGGREGATION_BITS:
        case AttestationErrorCode.ERR_KNOWN_BAD_BLOCK:
        case AttestationErrorCode.ERR_AGGREGATOR_NOT_IN_COMMITTEE:
        case AttestationErrorCode.ERR_INVALID_SELECTION_PROOF:
        case AttestationErrorCode.ERR_INVALID_SIGNATURE:
        case AttestationErrorCode.ERR_INVALID_INDEXED_ATTESTATION:
        case AttestationErrorCode.ERR_INVALID_AGGREGATOR:
          this.logger.warn("Rejecting gossip aggregate & Proof: ", e.type);
          return ExtendedValidatorResult.reject;
        case AttestationErrorCode.ERR_INVALID_SLOT_TIME:
        case AttestationErrorCode.ERR_AGGREGATE_ALREADY_KNOWN:
        case AttestationErrorCode.ERR_MISSING_ATTESTATION_PRESTATE:
          this.logger.warn("Ignoring gossip aggregate & Proof: ", e.type);
          return ExtendedValidatorResult.ignore;
        default:
          break;
      }
    }
    await this.db.seenAttestationCache.addAggregateAndProof(signedAggregateAndProof.message);
    return ExtendedValidatorResult.accept;
  };

  public isValidIncomingVoluntaryExit = async (
    voluntaryExit: SignedVoluntaryExit
  ): Promise<ExtendedValidatorResult> => {
    try {
      await validateGossipVoluntaryExit(this.config, this.chain, this.db, voluntaryExit);
    } catch (e) {
      this.logger.error("Error while validating gossip voluntary exit");
      switch (e.type.code) {
        case ProposerSlashingErrorCode.ERR_SLASHING_ALREADY_EXISTS:
          this.logger.warn("Ignoring gossip voluntary exit: ", e.type);
          return ExtendedValidatorResult.ignore;
        case ProposerSlashingErrorCode.ERR_INVALID_SLASHING:
          this.logger.warn("Rejecting gossip voluntary exit: ", e.type);
          return ExtendedValidatorResult.reject;
        default:
          break;
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
      this.logger.error("Error while validating gossip proposer slashing");
      switch (e.type.code) {
        case ProposerSlashingErrorCode.ERR_SLASHING_ALREADY_EXISTS:
          this.logger.warn("Ignoring gossip proposer slashing: ", e.type);
          return ExtendedValidatorResult.ignore;
        case ProposerSlashingErrorCode.ERR_INVALID_SLASHING:
          this.logger.warn("Rejecting gossip proposer slashing: ", e.type);
          return ExtendedValidatorResult.reject;
        default:
          break;
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
      this.logger.error("Error while validating gossip attester slashing");
      switch (e.type.code) {
        case AttesterSlashingErrorCode.ERR_SLASHING_ALREADY_EXISTS:
          this.logger.warn("Ignoring gossip attester slashing: ", e.type);
          return ExtendedValidatorResult.ignore;
        case AttesterSlashingErrorCode.ERR_INVALID_SLASHING:
          this.logger.warn("Rejecting gossip attester slashing: ", e.type);
          return ExtendedValidatorResult.reject;
        default:
          break;
      }
    }
    return ExtendedValidatorResult.accept;
  };
}
