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
import {validateGossipAggregateAndProof, validateGossipAttestation, validateGossipBlock} from "../../chain/validation";
import {BlockError, BlockErrorCode} from "../../chain/errors/blockError";
import {IBlockJob} from "../../chain";
import {AttestationError, AttestationErrorCode} from "../../chain/errors/attestationError";
import {AttesterSlashingError, AttesterSlashingErrorCode} from "../../chain/errors/attesterSlashingError";
import {validateGossipAttesterSlashing} from "../../chain/validation/attesterSlashing";
import {ProposerSlashingError, ProposerSlashingErrorCode} from "../../chain/errors/proposerSlahingError";
import {validateGossipProposerSlashing} from "../../chain/validation/proposerSlashing";
import {validateGossipVoluntaryExit} from "../../chain/validation/voluntaryExit";
import {VoluntaryExitError, VoluntaryExitErrorCode} from "../../chain/errors/voluntaryExitError";
import {toHexString} from "@chainsafe/ssz";

// eslint-disable-next-line @typescript-eslint/naming-convention
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
      const blockJob: IBlockJob = {
        signedBlock,
        reprocess: false,
        prefinalized: false,
        validSignatures: false,
        validProposerSignature: false,
      };

      this.logger.verbose("Started gossip block validation", logContext);
      await validateGossipBlock(this.config, this.chain, this.db, blockJob);
      this.logger.info("Received valid gossip block", logContext);

      return ExtendedValidatorResult.accept;
    } catch (e) {
      if (!(e instanceof BlockError)) {
        this.logger.error("Gossip block validation threw a non-BlockError", e);
        return ExtendedValidatorResult.ignore;
      }

      switch (e.type.code) {
        case BlockErrorCode.PROPOSAL_SIGNATURE_INVALID:
        case BlockErrorCode.INCORRECT_PROPOSER:
        case BlockErrorCode.KNOWN_BAD_BLOCK:
          this.logger.warn("Rejecting gossip block", logContext, e);
          return ExtendedValidatorResult.reject;

        case BlockErrorCode.FUTURE_SLOT:
        case BlockErrorCode.PARENT_UNKNOWN:
          await this.chain.receiveBlock(signedBlock);
          this.logger.warn("Ignoring gossip block", logContext, e);
          return ExtendedValidatorResult.ignore;

        case BlockErrorCode.WOULD_REVERT_FINALIZED_SLOT:
        case BlockErrorCode.REPEAT_PROPOSAL:
        default:
          this.logger.warn("Ignoring gossip block", logContext, e);
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

      this.logger.verbose("Started gossip committee attestation validation", logContext);
      await validateGossipAttestation(this.config, this.chain, this.db, attestationJob, subnet);
      this.logger.info("Received valid committee attestation", logContext);

      return ExtendedValidatorResult.accept;
    } catch (e) {
      if (!(e instanceof AttestationError)) {
        this.logger.error("Gossip attestation validation threw a non-AttestationError", e);
        return ExtendedValidatorResult.ignore;
      }
      switch (e.type.code) {
        case AttestationErrorCode.COMMITTEE_INDEX_OUT_OF_RANGE:
        case AttestationErrorCode.INVALID_SUBNET_ID:
        case AttestationErrorCode.BAD_TARGET_EPOCH:
        case AttestationErrorCode.NOT_EXACTLY_ONE_AGGREGATION_BIT_SET:
        case AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS:
        case AttestationErrorCode.INVALID_SIGNATURE:
        case AttestationErrorCode.KNOWN_BAD_BLOCK:
        case AttestationErrorCode.FINALIZED_CHECKPOINT_NOT_AN_ANCESTOR_OF_ROOT:
        case AttestationErrorCode.TARGET_BLOCK_NOT_AN_ANCESTOR_OF_LMD_BLOCK:
          this.logger.warn("Rejecting gossip attestation", logContext, e);
          return ExtendedValidatorResult.reject;

        case AttestationErrorCode.UNKNOWN_BEACON_BLOCK_ROOT:
        case AttestationErrorCode.MISSING_ATTESTATION_PRESTATE:
          this.logger.warn("Ignoring gossip attestation", logContext, e);
          return ExtendedValidatorResult.ignore;

        case AttestationErrorCode.PAST_SLOT:
        case AttestationErrorCode.FUTURE_SLOT:
        case AttestationErrorCode.ATTESTATION_ALREADY_KNOWN:
        default:
          this.logger.warn("Ignoring gossip attestation", logContext, e);
          return ExtendedValidatorResult.ignore;
      }
    } finally {
      await this.db.seenAttestationCache.addCommitteeAttestation(attestation);
    }
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

      this.logger.verbose("Started gossip aggregate and proof validation", logContext);
      await validateGossipAggregateAndProof(this.config, this.chain, this.db, signedAggregateAndProof, attestationJob);
      this.logger.info("Received valid gossip aggregate and proof", logContext);

      return ExtendedValidatorResult.accept;
    } catch (e) {
      if (!(e instanceof AttestationError)) {
        this.logger.error("Gossip aggregate and proof validation threw a non-AttestationError", e);
        return ExtendedValidatorResult.ignore;
      }

      switch (e.type.code) {
        case AttestationErrorCode.WRONG_NUMBER_OF_AGGREGATION_BITS:
        case AttestationErrorCode.KNOWN_BAD_BLOCK:
        case AttestationErrorCode.AGGREGATOR_NOT_IN_COMMITTEE:
        case AttestationErrorCode.INVALID_SELECTION_PROOF:
        case AttestationErrorCode.INVALID_SIGNATURE:
        case AttestationErrorCode.INVALID_AGGREGATOR:
          this.logger.warn("Rejecting gossip aggregate and proof", logContext, e);
          return ExtendedValidatorResult.reject;

        case AttestationErrorCode.FUTURE_SLOT:
          this.logger.warn("Ignoring gossip aggregate and proof", logContext, e);
          return ExtendedValidatorResult.ignore;

        case AttestationErrorCode.PAST_SLOT:
        case AttestationErrorCode.AGGREGATE_ALREADY_KNOWN:
        case AttestationErrorCode.MISSING_ATTESTATION_PRESTATE:
        default:
          this.logger.warn("Ignoring gossip aggregate and proof", logContext, e);
          return ExtendedValidatorResult.ignore;
      }
    } finally {
      await this.db.seenAttestationCache.addAggregateAndProof(signedAggregateAndProof.message);
    }
  };

  public isValidIncomingVoluntaryExit = async (
    voluntaryExit: SignedVoluntaryExit
  ): Promise<ExtendedValidatorResult> => {
    try {
      await validateGossipVoluntaryExit(this.config, this.chain, this.db, voluntaryExit);
      return ExtendedValidatorResult.accept;
    } catch (e) {
      if (!(e instanceof VoluntaryExitError)) {
        this.logger.error("Gossip voluntary exit validation threw a non-VoluntaryExitError", e);
        return ExtendedValidatorResult.ignore;
      }

      switch (e.type.code) {
        case VoluntaryExitErrorCode.INVALID_EXIT:
          this.logger.warn("Rejecting gossip voluntary exit", {}, e);
          return ExtendedValidatorResult.reject;

        case VoluntaryExitErrorCode.EXIT_ALREADY_EXISTS:
        default:
          this.logger.warn("Ignoring gossip voluntary exit", {}, e);
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
      if (!(e instanceof ProposerSlashingError)) {
        this.logger.error("Gossip proposer slashing validation threw a non-ProposerSlashingError", e);
        return ExtendedValidatorResult.ignore;
      }

      switch (e.type.code) {
        case ProposerSlashingErrorCode.INVALID_SLASHING:
          this.logger.warn("Rejecting gossip proposer slashing", {}, e);
          return ExtendedValidatorResult.reject;

        case ProposerSlashingErrorCode.SLASHING_ALREADY_EXISTS:
        default:
          this.logger.warn("Ignoring gossip proposer slashing", {}, e);
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
      if (!(e instanceof AttesterSlashingError)) {
        this.logger.error("Gossip attester slashing validation threw a non-AttesterSlashingError", e);
        return ExtendedValidatorResult.ignore;
      }

      switch (e.type.code) {
        case AttesterSlashingErrorCode.INVALID_SLASHING:
          this.logger.warn("Rejecting gossip attester slashing", {}, e);
          return ExtendedValidatorResult.reject;

        case AttesterSlashingErrorCode.SLASHING_ALREADY_EXISTS:
        default:
          this.logger.warn("Ignoring gossip attester slashing", {}, e);
          return ExtendedValidatorResult.ignore;
      }
    }
  };
}
