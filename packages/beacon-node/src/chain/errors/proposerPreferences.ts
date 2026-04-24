import {Slot, ValidatorIndex} from "@lodestar/types";
import {GossipActionError} from "./gossipValidation.js";

export enum ProposerPreferencesErrorCode {
  INVALID_EPOCH = "PROPOSER_PREFERENCES_ERROR_INVALID_EPOCH",
  PROPOSAL_SLOT_PASSED = "PROPOSER_PREFERENCES_ERROR_PROPOSAL_SLOT_PASSED",
  INVALID_PROPOSER = "PROPOSER_PREFERENCES_ERROR_INVALID_PROPOSER",
  ALREADY_KNOWN = "PROPOSER_PREFERENCES_ERROR_ALREADY_KNOWN",
  INVALID_SIGNATURE = "PROPOSER_PREFERENCES_ERROR_INVALID_SIGNATURE",
}

export type ProposerPreferencesErrorType =
  | {
      code: ProposerPreferencesErrorCode.INVALID_EPOCH;
      proposalSlot: Slot;
      currentEpoch: number;
    }
  | {
      code: ProposerPreferencesErrorCode.PROPOSAL_SLOT_PASSED;
      proposalSlot: Slot;
      stateSlot: Slot;
    }
  | {
      code: ProposerPreferencesErrorCode.INVALID_PROPOSER;
      proposalSlot: Slot;
      validatorIndex: ValidatorIndex;
    }
  | {
      code: ProposerPreferencesErrorCode.ALREADY_KNOWN;
      proposalSlot: Slot;
      validatorIndex: ValidatorIndex;
    }
  | {
      code: ProposerPreferencesErrorCode.INVALID_SIGNATURE;
      proposalSlot: Slot;
      validatorIndex: ValidatorIndex;
    };

export class ProposerPreferencesError extends GossipActionError<ProposerPreferencesErrorType> {}
