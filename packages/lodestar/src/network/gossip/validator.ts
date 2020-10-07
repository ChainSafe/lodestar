import {IGossipMessageValidator} from "./interface";
import {
  Attestation,
  AttesterSlashing,
  ProposerSlashing,
  SignedAggregateAndProof,
  SignedBeaconBlock,
  SignedVoluntaryExit,
  ValidatorIndex,
} from "@chainsafe/lodestar-types";
import {IBeaconDb} from "../../db";
import {
  isValidAttesterSlashing,
  isValidProposerSlashing,
  isValidVoluntaryExit,
} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils";
import {IBeaconChain} from "../../chain";
import {arrayIntersection, sszEqualPredicate} from "../../util/objects";
import {ExtendedValidatorResult} from "./constants";
import {validateGossipAggregateAndProof, validateGossipAttestation, validateGossipBlock} from "./validation";
import {BlockErrorCode} from "../../chain/errors/blockError";
import {IBlockProcessJob} from "../../chain";
import {AttestationErrorCode} from "../../chain/errors/attestationError";

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
      } as IBlockProcessJob;
      await validateGossipBlock(this.config, this.chain, this.db, this.logger, blockJob);
    } catch (e) {
      this.logger.error("Error while validating gossip block", e);
      if (e.code === BlockErrorCode.ERR_FUTURE_SLOT) return ExtendedValidatorResult.ignore;
      else if (e.code === BlockErrorCode.ERR_WOULD_REVERT_FINALIZED_SLOT) return ExtendedValidatorResult.ignore;
      else if (e.code === BlockErrorCode.ERR_REPEAT_PROPOSAL) return ExtendedValidatorResult.ignore;
      else if (e.code === BlockErrorCode.ERR_PROPOSAL_SIGNATURE_INVALID) return ExtendedValidatorResult.reject;
      else if (e.code === BlockErrorCode.ERR_PARENT_UNKNOWN) return ExtendedValidatorResult.ignore;
      else if (e.code === BlockErrorCode.ERR_PRESTATE_MISSING) return ExtendedValidatorResult.reject;
      else if (e.code === BlockErrorCode.ERR_CHECKPOINT_NOT_AN_ANCESTOR) return ExtendedValidatorResult.reject;
      else if (e.code === BlockErrorCode.ERR_INCORRECT_PROPOSER) return ExtendedValidatorResult.reject;
    }
    return ExtendedValidatorResult.accept;
  };

  public isValidIncomingCommitteeAttestation = async (
    attestation: Attestation,
    subnet: number
  ): Promise<ExtendedValidatorResult> => {
    try {
      await validateGossipAttestation(this.config, this.chain, this.db, this.logger, attestation, subnet);
    } catch (e) {
      this.logger.error("Error while validating gossip attestation", e);
      if (e.code === AttestationErrorCode.ERR_AGGREGATOR_NOT_IN_COMMITTEE) return ExtendedValidatorResult.reject;
      else if (e.code === AttestationErrorCode.ERR_INVALID_SUBNET_ID) return ExtendedValidatorResult.reject;
      else if (e.code === AttestationErrorCode.ERR_SLOT_OUT_OF_RANGE) return ExtendedValidatorResult.ignore;
      else if (e.code === AttestationErrorCode.ERR_BAD_TARGET_EPOCH) return ExtendedValidatorResult.reject;
      else if (e.code === AttestationErrorCode.ERR_NOT_EXACTLY_ONE_AGGREGATION_BIT_SET)
        return ExtendedValidatorResult.reject;
      else if (e.code === AttestationErrorCode.ERR_WRONG_NUMBER_OF_AGGREGATION_BITS)
        return ExtendedValidatorResult.reject;
      else if (e.code === AttestationErrorCode.ERR_ATTESTATION_ALREADY_KNOWN) return ExtendedValidatorResult.ignore;
      else if (e.code === AttestationErrorCode.ERR_INVALID_SIGNATURE) return ExtendedValidatorResult.reject;
      // else if ()
      // [IGNORE] The block being voted for (attestation.data.beacon_block_root) has been seen (via both gossip and non-gossip sources) (a client MAY queue aggregates for processing once block is retrieved).
      else if (e.code === AttestationErrorCode.ERR_KNOWN_BAD_BLOCK) return ExtendedValidatorResult.reject;
      else if (e.code === AttestationErrorCode.ERR_TARGET_BLOCK_NOT_AN_ANCESTOR_OF_ROOT)
        return ExtendedValidatorResult.reject;
      else if (e.code === AttestationErrorCode.ERR_CHECKPOINT_NOT_AN_ANCESTOR_OF_LMD_BLOCK)
        return ExtendedValidatorResult.reject;
    }
    return ExtendedValidatorResult.accept;
  };

  public isValidIncomingAggregateAndProof = async (
    signedAggregationAndProof: SignedAggregateAndProof
  ): Promise<ExtendedValidatorResult> => {
    try {
      return await validateGossipAggregateAndProof(
        this.config,
        this.chain,
        this.db,
        this.logger,
        signedAggregationAndProof
      );
    } catch (e) {
      this.logger.error("Error while validating gossip aggregate and proof", e);
      return ExtendedValidatorResult.ignore;
    }
  };

  public isValidIncomingVoluntaryExit = async (
    voluntaryExit: SignedVoluntaryExit
  ): Promise<ExtendedValidatorResult> => {
    // skip voluntary exit if it already exists
    if (await this.db.voluntaryExit.has(voluntaryExit.message.validatorIndex)) {
      return ExtendedValidatorResult.ignore;
    }
    const {state} = await this.chain.regen.getCheckpointState({
      root: this.chain.forkChoice.getHeadRoot(),
      epoch: voluntaryExit.message.epoch,
    });
    if (!isValidVoluntaryExit(this.config, state, voluntaryExit)) {
      return ExtendedValidatorResult.reject;
    }
    return ExtendedValidatorResult.accept;
  };

  public isValidIncomingProposerSlashing = async (
    proposerSlashing: ProposerSlashing
  ): Promise<ExtendedValidatorResult> => {
    // skip proposer slashing if it already exists
    if (await this.db.proposerSlashing.has(proposerSlashing.signedHeader1.message.proposerIndex)) {
      return ExtendedValidatorResult.ignore;
    }
    const state = await this.chain.getHeadState();
    if (!isValidProposerSlashing(this.config, state, proposerSlashing)) {
      return ExtendedValidatorResult.reject;
    }
    return ExtendedValidatorResult.accept;
  };

  public isValidIncomingAttesterSlashing = async (
    attesterSlashing: AttesterSlashing
  ): Promise<ExtendedValidatorResult> => {
    const attesterSlashedIndices = arrayIntersection<ValidatorIndex>(
      attesterSlashing.attestation1.attestingIndices.valueOf() as ValidatorIndex[],
      attesterSlashing.attestation2.attestingIndices.valueOf() as ValidatorIndex[],
      sszEqualPredicate(this.config.types.ValidatorIndex)
    );
    if (await this.db.attesterSlashing.hasAll(attesterSlashedIndices)) {
      return ExtendedValidatorResult.ignore;
    }

    const state = await this.chain.getHeadState();
    if (!isValidAttesterSlashing(this.config, state, attesterSlashing)) {
      return ExtendedValidatorResult.reject;
    }
    return ExtendedValidatorResult.accept;
  };
}
