import {Slot, ValidatorIndex, WithdrawalIndex} from "@lodestar/types";
import {ReturnTypes, RoutesData, Schema, sameType, ReqSerializers} from "../../utils/index.js";
import {HttpStatusCode} from "../../utils/client/httpStatusCode.js";
import {ApiClientResponse} from "../../interfaces.js";
import {StateId, ExecutionOptimistic} from "./beacon/state.js";

export type ExpectedWithdrawals = {
  index: WithdrawalIndex;
  validatorIndex: ValidatorIndex;
  address: string;
  amount: number;
};

// See /packages/api/src/routes/index.ts for reasoning and instructions to add new routes

export type Api = {
  getExpectedWithdrawals(
    stateId: StateId,
    proposalSlot?: Slot | undefined
  ): Promise<
    ApiClientResponse<
      {
        [HttpStatusCode.OK]: {
          executionOptimistic: ExecutionOptimistic;
          data: ExpectedWithdrawals[];
        };
      },
      HttpStatusCode.NOT_FOUND | HttpStatusCode.BAD_REQUEST
    >
  >;
};
/**
 * Define javascript values for each route
 */
export const routesData: RoutesData<Api> = {
  getExpectedWithdrawals: {url: "/eth/v1/builder/states/{state_id}/expected_withdrawals", method: "GET"},
};

/* eslint-disable @typescript-eslint/naming-convention */
export type ReqTypes = {
  getExpectedWithdrawals: {params: {state_id: StateId}; query: {proposal_slot?: Slot | undefined}};
};

export function getReqSerializers(): ReqSerializers<Api, ReqTypes> {
  return {
    getExpectedWithdrawals: {
      writeReq: (state_id, proposal_slot) => ({
        params: {state_id},
        query: {proposal_slot},
      }),
      parseReq: ({params, query}) => [params.state_id, query.proposal_slot],
      schema: {
        params: {state_id: Schema.StringRequired},
        query: {proposal_slot: Schema.Uint},
      },
    },
  };
}

export function getReturnTypes(): ReturnTypes<Api> {
  return {
    // Just sent the proof JSON as-is
    getExpectedWithdrawals: sameType(),
  };
}
