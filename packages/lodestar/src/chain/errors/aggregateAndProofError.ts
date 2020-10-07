import {Epoch, Slot} from "@chainsafe/lodestar-types";
import {LodestarError} from "@chainsafe/lodestar-utils";

export enum AggregateAndProofErrorCode {
  ERR_INVALID_SLOT_TIME = "ERR_INVALID_SLOT_TIME ",
  ERR_AGGREGATE_ALREADY_SEEN = "ERR_AGGREGATE_ALREADY_SEEN",
  ERR_MISSING_PARTICIPANTS = "ERR_MISSING_PARTICIPANTS",
  ERR_INVALID_BLOCK = "ERR_INVALID_BLOCK",
  ERR_MISSING_ATTESTATION_PRESTATE = "ERR_MISSING_ATTESTATION_PRESTATE",
}
export type AggregateAndProofErrorType =
  | {
      code: AggregateAndProofErrorCode.ERR_AGGREGATE_ALREADY_SEEN;
      targetEpoch: Epoch;
    }
  | {
      code: AggregateAndProofErrorCode.ERR_INVALID_SLOT_TIME;
      currentSlot: Slot;
    }
  | {
      code: AggregateAndProofErrorCode.ERR_MISSING_PARTICIPANTS;
    }
  | {
      code: AggregateAndProofErrorCode.ERR_INVALID_BLOCK;
    }
  | {
      code: AggregateAndProofErrorCode.ERR_MISSING_ATTESTATION_PRESTATE;
    };

export class AggregateAndProofError extends LodestarError<AggregateAndProofErrorType> {
  constructor(type: AggregateAndProofErrorType) {
    super(type);
  }
}
