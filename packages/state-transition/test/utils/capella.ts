import {ssz} from "@lodestar/types";
import {config} from "@lodestar/config/default";
import {BLS_WITHDRAWAL_PREFIX, ETH1_ADDRESS_WITHDRAWAL_PREFIX} from "@lodestar/params";
import {CachedBeaconStateCapella} from "../../src/index.js";
import {createCachedBeaconStateTest} from "./state.js";
import {mulberry32} from "./rand.js";

export interface WithdrawalOpts {
  excessBalance: number;
  eth1Credentials: number;
  withdrawable: number;
  withdrawn: number;
}

/**
 * Create a state that has `lowBalanceRatio` fraction (0,1) of validators with balance < max effective
 * balance and `blsCredentialRatio` fraction (0,1) of withdrawal credentials not set for withdrawals
 */
export function getExpectedWithdrawalsTestData(vc: number, opts: WithdrawalOpts): CachedBeaconStateCapella {
  const state = ssz.capella.BeaconState.defaultViewDU();
  state.slot = 1;

  const withdrawalCredentialsEth1 = Buffer.alloc(32, 0xaa);
  const withdrawalCredentialsBls = Buffer.alloc(32, 0xbb);
  withdrawalCredentialsEth1[0] = ETH1_ADDRESS_WITHDRAWAL_PREFIX;
  withdrawalCredentialsBls[0] = BLS_WITHDRAWAL_PREFIX;

  const pubkey = Buffer.alloc(48, 0xdd);

  const rand = mulberry32(0xdddddddd);

  for (let i = 0; i < vc; i++) {
    // work in percentages to have more resolution
    const hasExcessBalance = rand() < opts.excessBalance;
    const hasEth1Credential = rand() < opts.eth1Credentials;
    const isWithdrawable = rand() < opts.withdrawable;
    const isWithdrawn = rand() < opts.withdrawn;

    const balance = isWithdrawn ? 0 : hasExcessBalance ? 33e9 : 30e9;
    state.balances.push(balance);

    const activeValidator = ssz.phase0.Validator.toViewDU({
      pubkey,
      withdrawalCredentials: hasEth1Credential ? withdrawalCredentialsEth1 : withdrawalCredentialsBls,
      effectiveBalance: 32e9,
      slashed: false,
      activationEligibilityEpoch: 0,
      activationEpoch: 0,
      exitEpoch: isWithdrawn || isWithdrawable ? 0 : Infinity,
      withdrawableEpoch: isWithdrawn || isWithdrawable ? 0 : Infinity,
    });

    // Initialize tree
    state.validators.push(activeValidator);
  }

  state.commit();

  return createCachedBeaconStateTest(state, config, {skipSyncPubkeys: true});
}
