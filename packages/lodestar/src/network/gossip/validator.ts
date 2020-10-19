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
import {BlockError, BlockErrorCode} from "../../chain/errors/blockError";
import {IBlockJob} from "../../chain";
import {AttestationError, AttestationErrorCode} from "../../chain/errors/attestationError";
import {AttesterSlashingError, AttesterSlashingErrorCode} from "../../chain/errors/attesterSlashingError";
import {validateGossipAttesterSlashing} from "./validation/attesterSlashing";
import {ProposerSlashingError, ProposerSlashingErrorCode} from "../../chain/errors/proposerSlahingError";
import {validateGossipProposerSlashing} from "./validation/proposerSlashing";
import {validateGossipVoluntaryExit} from "./validation/voluntaryExit";
import {VoluntaryExitError, VoluntaryExitErrorCode} from "../../chain/errors/voluntaryExitError";
import {toHexString} from "@chainsafe/ssz";

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
    const logContext = {
      blockRoot: toHexString(this.config.types.BeaconBlock.hashTreeRoot(signedBlock.message)),
      blockSlot: signedBlock.message.slot,
    };
    try {
      const blockJob = {
        signedBlock: signedBlock,
        trusted: false,
        reprocess: false,
      } as IBlockJob;
      this.logger.verbose("Started gossip block validation", logContext);
      await validateGossipBlock(this.config, this.chain, this.db, blockJob);
      this.logger.info("Received valid gossip block", logContext);
      return ExtendedValidatorResult.accept;
    } catch (e) {
      this.logger.error("Error while validating gossip block");
      if (!(e instanceof BlockError)) {
        this.logger.error("Gossip block validation threw a non-BlockError", e);
        return ExtendedValidatorResult.ignore;
      }
      switch (e.type.code) {
        case BlockErrorCode.ERR_PROPOSAL_SIGNATURE_INVALID:
        case BlockErrorCode.ERR_INCORRECT_PROPOSER:
        case BlockErrorCode.ERR_KNOWN_BAD_BLOCK:
          this.logger.warn("Rejecting gossip block: ", {...e.getMetadata(), ...logContext});
          return ExtendedValidatorResult.reject;
        case BlockErrorCode.ERR_FUTURE_SLOT:
        case BlockErrorCode.ERR_WOULD_REVERT_FINALIZED_SLOT:
        case BlockErrorCode.ERR_REPEAT_PROPOSAL:
        case BlockErrorCode.ERR_PARENT_UNKNOWN:
        default:
          this.logger.warn("Ignoring gossip block: ", {...e.getMetadata(), ...logContext});
          return ExtendedValidatorResult.ignore;
      }
    }
  };

  public isValidIncomingCommitteeAttestation = async (
    attestation: Attestation,
    subnet: number
  ): Promise<ExtendedValidatorResult> => {
    const logContext = {
      attestationSlot: attestation.data.slot,
      attestationBlockRoot: toHexString(attestation.data.beaconBlockRoot),
      attestationRoot: toHexString(this.config.types.Attestation.hashTreeRoot(attestation)),
      subnet,
    };
    try {
      const attestationJob = {
        attestation,
        validSignature: false,
      } as IAttestationJob;
      this.logger.profile("gossipAttestationValidation");
      this.logger.verbose("Started gossip committee attestation validation", logContext);
      await validateGossipAttestation(this.config, this.chain, this.db, attestationJob, subnet);
      this.logger.info("Received valid committee attestation", logContext);
    } catch (e) {
      this.logger.error("Error while validating gossip attestation");
      if (!(e instanceof AttestationError)) {
        this.logger.error("Gossip attestation validation threw a non-AttestationError", e);
        return ExtendedValidatorResult.ignore;
      }
      switch (e.type.code) {
        case AttestationErrorCode.ERR_COMMITTEE_INDEX_OUT_OF_RANGE:
        case AttestationErrorCode.ERR_INVALID_SUBNET_ID:
        case AttestationErrorCode.ERR_BAD_TARGET_EPOCH:
        case AttestationErrorCode.ERR_NOT_EXACTLY_ONE_AGGREGATION_BIT_SET:
        case AttestationErrorCode.ERR_WRONG_NUMBER_OF_AGGREGATION_BITS:
        case AttestationErrorCode.ERR_INVALID_SIGNATURE:
        case AttestationErrorCode.ERR_KNOWN_BAD_BLOCK:
        case AttestationErrorCode.ERR_FINALIZED_CHECKPOINT_NOT_AN_ANCESTOR_OF_ROOT:
        case AttestationErrorCode.ERR_TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK:
          this.logger.warn("Rejecting gossip attestation: ", {...e.getMetadata(), ...logContext});
          return ExtendedValidatorResult.reject;
        case AttestationErrorCode.ERR_INVALID_SLOT_TIME:
        case AttestationErrorCode.ERR_ATTESTATION_ALREADY_KNOWN:
        case AttestationErrorCode.ERR_UNKNOWN_BEACON_BLOCK_ROOT:
        case AttestationErrorCode.ERR_MISSING_ATTESTATION_PRESTATE:
        default:
          this.logger.warn("Ignoring gossip attestation: ", {...e.getMetadata(), ...logContext});
          return ExtendedValidatorResult.ignore;
      }
    }
    return ExtendedValidatorResult.accept;
  };

  public isValidIncomingAggregateAndProof = async (
    signedAggregateAndProof: SignedAggregateAndProof
  ): Promise<ExtendedValidatorResult> => {
    const attestation = signedAggregateAndProof.message.aggregate;
    const logContext = {
      attestationSlot: attestation.data.slot,
      aggregatorIndex: signedAggregateAndProof.message.aggregatorIndex,
      aggregateRoot: toHexString(this.config.types.AggregateAndProof.hashTreeRoot(signedAggregateAndProof.message)),
      attestationRoot: toHexString(this.config.types.Attestation.hashTreeRoot(attestation)),
      targetEpoch: attestation.data.target.epoch,
    };
    try {
      const attestationJob = {
        attestation: attestation,
        validSignature: false,
      } as IAttestationJob;
      this.logger.profile("gossipAggregateAndProofValidation");
      this.logger.verbose("Started gossip aggregate and proof validation", logContext);
      await this.db.seenAttestationCache.addAggregateAndProof(signedAggregateAndProof.message);
      await validateGossipAggregateAndProof(this.config, this.chain, this.db, signedAggregateAndProof, attestationJob);
      this.logger.info("Received valid gossip aggregate and proof", logContext);
      return ExtendedValidatorResult.accept;
    } catch (e) {
      this.logger.error("Error while validating gossip aggregate and proof");
      if (!(e instanceof AttestationError)) {
        this.logger.error("Gossip aggregate and proof validation threw a non-AttestationError", e);
        return ExtendedValidatorResult.ignore;
      }
      switch (e.type.code) {
        case AttestationErrorCode.ERR_WRONG_NUMBER_OF_AGGREGATION_BITS:
        case AttestationErrorCode.ERR_KNOWN_BAD_BLOCK:
        case AttestationErrorCode.ERR_AGGREGATOR_NOT_IN_COMMITTEE:
        case AttestationErrorCode.ERR_INVALID_SELECTION_PROOF:
        case AttestationErrorCode.ERR_INVALID_SIGNATURE:
        case AttestationErrorCode.ERR_INVALID_AGGREGATOR:
          this.logger.warn("Rejecting gossip aggregate and Proof: ", {...e.getMetadata(), ...logContext});
          return ExtendedValidatorResult.reject;
        case AttestationErrorCode.ERR_INVALID_SLOT_TIME:
        case AttestationErrorCode.ERR_AGGREGATE_ALREADY_KNOWN:
        case AttestationErrorCode.ERR_MISSING_ATTESTATION_PRESTATE:
        default:
          this.logger.warn("Ignoring gossip aggregate and Proof: ", {...e.getMetadata(), ...logContext});
          return ExtendedValidatorResult.ignore;
      }
    }
  };

  public isValidIncomingVoluntaryExit = async (
    voluntaryExit: SignedVoluntaryExit
  ): Promise<ExtendedValidatorResult> => {
    try {
      await validateGossipVoluntaryExit(this.config, this.chain, this.db, voluntaryExit);
      return ExtendedValidatorResult.accept;
    } catch (e) {
      this.logger.error("Error while validating gossip voluntary exit");
      if (!(e instanceof VoluntaryExitError)) {
        this.logger.error("Gossip voluntary exit validation threw a non-VoluntaryExitError", e);
        return ExtendedValidatorResult.ignore;
      }
      switch (e.type.code) {
        case VoluntaryExitErrorCode.ERR_INVALID_EXIT:
          this.logger.warn("Rejecting gossip voluntary exit: ", e.getMetadata());
          return ExtendedValidatorResult.reject;
        case VoluntaryExitErrorCode.ERR_EXIT_ALREADY_EXISTS:
        default:
          this.logger.warn("Ignoring gossip voluntary exit: ", e.getMetadata());
          return ExtendedValidatorResult.ignore;
      }
    }
  };

  public isValidIncomingProposerSlashing = async (
    proposerSlashing: ProposerSlashing
  ): Promise<ExtendedValidatorResult> => {
    try {
      await validateGossipProposerSlashing(this.config, this.chain, this.db, proposerSlashing);
      return ExtendedValidatorResult.accept;
    } catch (e) {
      this.logger.error("Error while validating gossip proposer slashing");
      if (!(e instanceof ProposerSlashingError)) {
        this.logger.error("Gossip proposer slashing validation threw a non-ProposerSlashingError", e);
        return ExtendedValidatorResult.ignore;
      }
      switch (e.type.code) {
        case ProposerSlashingErrorCode.ERR_INVALID_SLASHING:
          this.logger.warn("Rejecting gossip proposer slashing: ", e.getMetadata());
          return ExtendedValidatorResult.reject;
        case ProposerSlashingErrorCode.ERR_SLASHING_ALREADY_EXISTS:
        default:
          this.logger.warn("Ignoring gossip proposer slashing: ", e.getMetadata());
          return ExtendedValidatorResult.ignore;
      }
    }
  };

  public isValidIncomingAttesterSlashing = async (
    attesterSlashing: AttesterSlashing
  ): Promise<ExtendedValidatorResult> => {
    try {
      await validateGossipAttesterSlashing(this.config, this.chain, this.db, attesterSlashing);
      return ExtendedValidatorResult.accept;
    } catch (e) {
      this.logger.error("Error while validating gossip attester slashing");
      if (!(e instanceof AttesterSlashingError)) {
        this.logger.error("Gossip attester slashing validation threw a non-AttesterSlashingError", e);
        return ExtendedValidatorResult.ignore;
      }
      switch (e.type.code) {
        case AttesterSlashingErrorCode.ERR_INVALID_SLASHING:
          this.logger.warn("Rejecting gossip attester slashing: ", e.getMetadata());
          return ExtendedValidatorResult.reject;
        case AttesterSlashingErrorCode.ERR_SLASHING_ALREADY_EXISTS:
        default:
          this.logger.warn("Ignoring gossip attester slashing: ", e.getMetadata());
          return ExtendedValidatorResult.ignore;
      }
    }
  };
}
