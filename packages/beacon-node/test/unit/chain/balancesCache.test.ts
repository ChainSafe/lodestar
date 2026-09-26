import {describe, expect, it} from "vitest";
import {config} from "@lodestar/config/default";
import {EFFECTIVE_BALANCE_INCREMENT, FAR_FUTURE_EPOCH, MAX_EFFECTIVE_BALANCE} from "@lodestar/params";
import {BeaconStateView} from "@lodestar/state-transition";
import {getJustifiedBalances} from "../../../src/chain/balancesCache.js";
import {createCachedBeaconStateTest} from "../../utils/cachedBeaconState.js";
import {generateState} from "../../utils/state.js";
import {generateValidators} from "../../utils/validator.js";

describe("getJustifiedBalances", () => {
  it("should zero active slashed validators in balances but count them in total balance", () => {
    const active = {
      activationEpoch: 0,
      exitEpoch: FAR_FUTURE_EPOCH,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
      effectiveBalance: MAX_EFFECTIVE_BALANCE,
    };
    const validators = [
      ...generateValidators(1, active, 0),
      ...generateValidators(1, {...active, slashed: true}, 1),
      ...generateValidators(1, {...active, activationEpoch: FAR_FUTURE_EPOCH}, 2),
    ];
    const state = new BeaconStateView(createCachedBeaconStateTest(generateState({validators}, config), config));

    const {balances, totalBalance} = getJustifiedBalances(state);

    const increments = MAX_EFFECTIVE_BALANCE / EFFECTIVE_BALANCE_INCREMENT;
    expect(Array.from(balances)).toEqual([increments, 0, 0]);
    expect(totalBalance).toBe(2 * increments);
  });
});
