import crypto from "node:crypto";
import {ssz} from "@lodestar/types";
import {config} from "@lodestar/config/default";
import {
  BLS_WITHDRAWAL_PREFIX,
  ETH1_ADDRESS_WITHDRAWAL_PREFIX,
  SLOTS_PER_EPOCH,
  SLOTS_PER_HISTORICAL_ROOT,
} from "@lodestar/params";
import {BeaconStateCapella, CachedBeaconStateCapella} from "../../src/index.js";
import {createCachedBeaconStateTest} from "./state.js";
import {mulberry32} from "./rand.js";
import {interopPubkeysCached} from "./interop.js";

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

export function newStateWithValidators(numValidator: number): BeaconStateCapella {
  // use real pubkeys to test loadCachedBeaconState api
  const pubkeys = interopPubkeysCached(numValidator);
  const capellaStateType = ssz.capella.BeaconState;
  const stateView = capellaStateType.defaultViewDU();
  stateView.slot = config.CAPELLA_FORK_EPOCH * SLOTS_PER_EPOCH + 100;
  for (let i = 0; i < SLOTS_PER_HISTORICAL_ROOT; i++) {
    stateView.blockRoots.set(i, crypto.randomBytes(32));
  }

  for (let i = 0; i < numValidator; i++) {
    const validator = ssz.phase0.Validator.defaultViewDU();
    validator.pubkey = pubkeys[i];
    // make all validators active
    validator.activationEpoch = 0;
    validator.exitEpoch = Infinity;
    validator.effectiveBalance = 32e9;
    stateView.validators.push(validator);
    stateView.balances.push(32);
    stateView.inactivityScores.push(0);
    stateView.previousEpochParticipation.push(0b11111111);
    stateView.currentEpochParticipation.push(0b11111111);
  }
  stateView.commit();
  return stateView;
}

/**
 * Modify a state without changing number of validators
 */
export function modifyStateSameValidator(seedState: BeaconStateCapella): BeaconStateCapella {
  const slotDiff = 10;
  const state = seedState.clone();
  state.slot = seedState.slot + slotDiff;
  state.latestBlockHeader = ssz.phase0.BeaconBlockHeader.toViewDU({
    slot: state.slot,
    proposerIndex: 0,
    parentRoot: state.hashTreeRoot(),
    stateRoot: state.hashTreeRoot(),
    bodyRoot: ssz.phase0.BeaconBlockBody.hashTreeRoot(ssz.phase0.BeaconBlockBody.defaultValue()),
  });
  for (let i = 1; i <= slotDiff; i++) {
    state.blockRoots.set((seedState.slot + i) % SLOTS_PER_HISTORICAL_ROOT, crypto.randomBytes(32));
  }
  state.blockRoots.set(0, crypto.randomBytes(32));
  state.stateRoots.set(0, crypto.randomBytes(32));
  state.historicalRoots.push(crypto.randomBytes(32));
  state.eth1Data.depositCount = 1000;
  state.eth1DataVotes.push(ssz.phase0.Eth1Data.toViewDU(ssz.phase0.Eth1Data.defaultValue()));
  state.eth1DepositIndex = 1000;
  state.balances.set(0, 30);
  state.randaoMixes.set(0, crypto.randomBytes(32));
  state.slashings.set(0, 1);
  state.previousEpochParticipation.set(0, 0b11111110);
  state.currentEpochParticipation.set(0, 0b11111110);
  state.justificationBits.set(0, true);
  state.previousJustifiedCheckpoint.epoch = 1;
  state.currentJustifiedCheckpoint.epoch = 1;
  state.finalizedCheckpoint.epoch++;
  state.latestExecutionPayloadHeader.blockNumber = 1;
  state.nextWithdrawalIndex = 1000;
  state.nextWithdrawalValidatorIndex = 1000;
  state.historicalSummaries.push(ssz.capella.HistoricalSummary.toViewDU(ssz.capella.HistoricalSummary.defaultValue()));
  state.commit();
  return state;
}
