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
  computeStartSlotAtEpoch,
  isValidAttesterSlashing,
  isValidProposerSlashing,
  isValidVoluntaryExit,
} from "@chainsafe/lodestar-beacon-state-transition";
import {processSlots,} from "@chainsafe/lodestar-beacon-state-transition/lib/fast/slot";
import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ILogger} from "@chainsafe/lodestar-utils/lib/logger";
import {IBeaconChain} from "../../chain";
import {arrayIntersection, sszEqualPredicate} from "../../util/objects";
import {validateGossipAggregateAndProof, validateGossipBlock, validateGossipCommitteeAttestation} from "./validation";
import {ExtendedValidatorResult} from "./constants";

interface IGossipMessageValidatorModules {
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

  public constructor({chain, db, config, logger}: IGossipMessageValidatorModules) {
    this.chain = chain;
    this.db = db;
    this.config = config;
    this.logger = logger;
  }

  public isValidIncomingBlock = async (signedBlock: SignedBeaconBlock): Promise<ExtendedValidatorResult> => {
    return validateGossipBlock(this.config, this.chain, this.db, this.logger, signedBlock);
  };

  public isValidIncomingCommitteeAttestation = async (
    attestation: Attestation, subnet: number
  ): Promise<ExtendedValidatorResult> => {
    return validateGossipCommitteeAttestation(this.config, this.chain, this.db, this.logger, attestation, subnet);
  };

  public isValidIncomingAggregateAndProof = async (
    signedAggregationAndProof: SignedAggregateAndProof
  ): Promise<ExtendedValidatorResult> => {
    return validateGossipAggregateAndProof(this.config, this.chain, this.db, this.logger, signedAggregationAndProof);
  };

  public isValidIncomingVoluntaryExit = async(voluntaryExit: SignedVoluntaryExit): Promise<ExtendedValidatorResult> => {
    // skip voluntary exit if it already exists
    if (await this.db.voluntaryExit.has(voluntaryExit.message.validatorIndex)) {
      return ExtendedValidatorResult.ignore;
    }
    const {state, epochCtx} = await this.chain.getHeadStateContext();
    const startSlot = computeStartSlotAtEpoch(this.config, voluntaryExit.message.epoch);
    if (state.slot < startSlot) {
      processSlots(epochCtx, state, startSlot);
    }
    if (!isValidVoluntaryExit(this.config, state, voluntaryExit)) {
      return ExtendedValidatorResult.reject;
    }
    return ExtendedValidatorResult.accept;
  };

  public isValidIncomingProposerSlashing =
  async(proposerSlashing: ProposerSlashing): Promise<ExtendedValidatorResult> => {
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

  public isValidIncomingAttesterSlashing =
  async (attesterSlashing: AttesterSlashing): Promise<ExtendedValidatorResult> => {
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
