import {routes, ServerApi} from "@lodestar/api";
import {Slot} from "@lodestar/types";
import {getExpectedWithdrawals} from "@lodestar/state-transition";
import {CachedBeaconStateCapella} from "@lodestar/state-transition/src/types.js";
import {ExpectedWithdrawals} from "@lodestar/api/src/beacon/routes/builder.js";
import {ApiModules} from "../types.js";
import {resolveStateId} from "../beacon/state/utils.js";

export function getBuilderApi({chain}: Pick<ApiModules, "chain" | "config">): ServerApi<routes.builder.Api> {
  return {
    async getExpectedWithdrawals(stateId: routes.beacon.StateId, proposalSlot?: Slot | undefined) {
      const {state, executionOptimistic} = await resolveStateId(chain, stateId, {allowRegen: true});
      const expectedWithdrawals = getExpectedWithdrawals(state as CachedBeaconStateCapella).withdrawals;
      // eslint-disable-next-line no-console
      console.log("Prolosal Slot", proposalSlot, "State data", state, "expectedWithdrawlsData", expectedWithdrawals);
      return {
        executionOptimistic: executionOptimistic,
        data: expectedWithdrawals.map((item: {address: Uint8Array}) => ({
          ...item,
          address: Buffer.from(item.address).toString("hex"), // Convert Uint8Array to hexadecimal string
        })) as ExpectedWithdrawals[],
      };
    },
  };
}

// data: [
//   {
//     index: 1,
//     validatorIndex: 1,
//     address: "0xAbcF8e0d4e9587369b2301D0790347320302cc09",
//     amount: 1,
//   },
// ],
