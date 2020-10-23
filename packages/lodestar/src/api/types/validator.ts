import {BLSPubkey, Validator, ValidatorIndex} from "@chainsafe/lodestar-types";
import {ContainerType} from "@chainsafe/ssz";
import {IBeaconConfig} from "../../../../lodestar-config/src/interface";
import {StringType} from "./ssz";

export enum ValidatorStatus {
  WAITING_FOR_ELIGIBILITY = "waiting_for_eligibility",
  WAITING_FOR_FINALITY = "waiting_for_finality",
  WAITING_IN_QUEUE = "waiting_in_queue",
  STANDBY_FOR_ACTIVE = "standby_for_active",
  ACTIVE = "active",
  ACTIVE_AWAITING_VOLUNTARY_EXIT = "active_awaiting_voluntary_exit",
  ACTIVE_AWAITING_SLASHED_EXIT = "active_awaiting_slashed_exit",
  EXITED_VOLUNTARILY = "exited_voluntarily",
  EXITED_SLASHED = "exited_slashed",
  WITHDRAWABLE_VOLUNTARILY = "withdrawable_voluntarily",
  WITHDRAWABLE_SLASHED = "withdrawable_slashed",
  WITHDRAWN_VOLUNTARILY = "withdrawn_voluntarily",
  WITHDRAWN_SLASHED = "withdrawn_slashed",
}

export type ValidatorResponse = {
  index: ValidatorIndex;
  pubkey: BLSPubkey;
  status: ValidatorStatus;
  validator: Validator;
};

export const ValidatorResponse = (config: IBeaconConfig): ContainerType<ValidatorResponse> =>
  new ContainerType({
    fields: {
      index: config.types.ValidatorIndex,
      pubkey: config.types.BLSPubkey,
      status: new StringType(),
      validator: config.types.Validator,
    },
  });
