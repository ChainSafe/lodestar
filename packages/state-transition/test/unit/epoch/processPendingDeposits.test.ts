import {beforeEach, describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {ChainForkConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {
  BLS_WITHDRAWAL_PREFIX,
  COMPOUNDING_WITHDRAWAL_PREFIX,
  DOMAIN_DEPOSIT,
  ETH1_ADDRESS_WITHDRAWAL_PREFIX,
  FAR_FUTURE_EPOCH,
  ForkName,
  GENESIS_SLOT,
  MIN_ACTIVATION_BALANCE,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {Slot, electra, ssz} from "@lodestar/types";
import {beforeProcessEpoch} from "../../../src/cache/epochTransitionCache.js";
import {ZERO_HASH} from "../../../src/constants/index.js";
import {processPendingDeposits} from "../../../src/epoch/processPendingDeposits.js";
import {createCachedBeaconStateTest} from "../../../src/testUtils/state.js";
import {BeaconStateAllForks, CachedBeaconStateElectra} from "../../../src/types.js";
import {computeDomain} from "../../../src/util/domain.js";
import {interopSecretKey} from "../../../src/util/interop.js";
import {computeSigningRoot} from "../../../src/util/signingRoot.js";
import {getActivationChurnLimit} from "../../../src/util/validator.js";

const existingValidatorCount = 4;
const newKeyIndex = existingValidatorCount;

function withdrawalCredentials(prefix: number): Uint8Array {
  const credentials = new Uint8Array(32);
  credentials[0] = prefix;
  credentials.fill(0xab, 12);
  return credentials;
}

function createState(
  fork: ForkName.gloas | ForkName.heze,
  config: ChainForkConfig,
  slot: Slot = GENESIS_SLOT
): CachedBeaconStateElectra {
  const state = ssz[fork].BeaconState.defaultViewDU();
  state.slot = slot;
  for (let i = 0; i < existingValidatorCount; i++) {
    state.validators.push(
      ssz.phase0.Validator.toViewDU({
        pubkey: interopSecretKey(i).toPublicKey().toBytes(),
        withdrawalCredentials: withdrawalCredentials(BLS_WITHDRAWAL_PREFIX),
        effectiveBalance: MIN_ACTIVATION_BALANCE,
        slashed: false,
        activationEligibilityEpoch: 0,
        activationEpoch: 0,
        exitEpoch: FAR_FUTURE_EPOCH,
        withdrawableEpoch: FAR_FUTURE_EPOCH,
      })
    );
    state.balances.push(MIN_ACTIVATION_BALANCE);
    state.previousEpochParticipation.push(0);
    state.currentEpochParticipation.push(0);
    state.inactivityScores.push(0);
  }
  state.commit();
  return createCachedBeaconStateTest<BeaconStateAllForks>(state, config, {
    skipSyncCommitteeCache: true,
  }) as CachedBeaconStateElectra;
}

function pendingDeposit(
  config: ChainForkConfig,
  keyIndex: number,
  prefix: number,
  amount = MIN_ACTIVATION_BALANCE,
  signed = true
): electra.PendingDeposit {
  const secretKey = interopSecretKey(keyIndex);
  const pubkey = secretKey.toPublicKey().toBytes();
  const credentials = withdrawalCredentials(prefix);
  const domain = computeDomain(DOMAIN_DEPOSIT, config.GENESIS_FORK_VERSION, ZERO_HASH);
  const signingRoot = computeSigningRoot(
    ssz.phase0.DepositMessage,
    {pubkey, withdrawalCredentials: credentials, amount},
    domain
  );
  return {
    pubkey,
    withdrawalCredentials: credentials,
    amount,
    signature: signed ? secretKey.sign(signingRoot).toBytes() : new Uint8Array(96),
    slot: GENESIS_SLOT,
  };
}

function runProcessPendingDeposits(state: CachedBeaconStateElectra, deposits: electra.PendingDeposit[]) {
  for (const deposit of deposits) {
    state.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(deposit));
  }
  state.commit();
  const cache = beforeProcessEpoch(state);
  cache.balances = state.balances.getAll();
  processPendingDeposits(state, cache);
  return cache;
}

describe("processPendingDeposits", () => {
  beforeEach(() => pubkeyCache.reset());

  describe("heze", () => {
    const config = getConfig(ForkName.heze);

    it.each([
      {signed: true, name: "a valid"},
      {signed: false, name: "an invalid"},
    ])("skips a deposit with $name signature that would create a validator with BLS credentials", ({signed}) => {
      const state = createState(ForkName.heze, config);
      const deposit = pendingDeposit(config, newKeyIndex, BLS_WITHDRAWAL_PREFIX, MIN_ACTIVATION_BALANCE, signed);

      const cache = runProcessPendingDeposits(state, [deposit]);

      expect(state.validators.length).toBe(existingValidatorCount);
      expect(state.epochCtx.getValidatorIndex(deposit.pubkey)).toBeNull();
      expect(state.balances.getAll()).toEqual(cache.balances);
      expect(cache.isCompoundingValidatorArr.length).toBe(existingValidatorCount);
      expect(state.pendingDeposits.length).toBe(0);
    });

    it("applies a top-up to an existing validator with BLS credentials without checking the signature", () => {
      const state = createState(ForkName.heze, config);
      const deposit = pendingDeposit(config, 0, BLS_WITHDRAWAL_PREFIX, MIN_ACTIVATION_BALANCE, false);

      const cache = runProcessPendingDeposits(state, [deposit]);

      expect(state.validators.length).toBe(existingValidatorCount);
      expect(state.balances.get(0)).toBe(2 * MIN_ACTIVATION_BALANCE);
      expect(cache.balances?.[0]).toBe(2 * MIN_ACTIVATION_BALANCE);
      expect(state.pendingDeposits.length).toBe(0);
    });

    it.each([
      {prefix: ETH1_ADDRESS_WITHDRAWAL_PREFIX, compounding: false},
      {prefix: COMPOUNDING_WITHDRAWAL_PREFIX, compounding: true},
    ])("creates a validator with 0x0$prefix credentials", ({prefix, compounding}) => {
      const state = createState(ForkName.heze, config);
      const deposit = pendingDeposit(config, newKeyIndex, prefix);

      const cache = runProcessPendingDeposits(state, [deposit]);

      expect(state.validators.length).toBe(existingValidatorCount + 1);
      expect(state.validators.getReadonly(newKeyIndex).withdrawalCredentials).toEqual(deposit.withdrawalCredentials);
      expect(state.balances.get(newKeyIndex)).toBe(MIN_ACTIVATION_BALANCE);
      expect(cache.balances?.[newKeyIndex]).toBe(MIN_ACTIVATION_BALANCE);
      expect(cache.isCompoundingValidatorArr[newKeyIndex]).toBe(compounding);
    });

    it("creates the validator from a later deposit with execution credentials for the same pubkey", () => {
      const state = createState(ForkName.heze, config);
      const blsDeposit = pendingDeposit(config, newKeyIndex, BLS_WITHDRAWAL_PREFIX);
      const eth1Deposit = pendingDeposit(config, newKeyIndex, ETH1_ADDRESS_WITHDRAWAL_PREFIX);

      runProcessPendingDeposits(state, [blsDeposit, eth1Deposit]);

      expect(state.validators.length).toBe(existingValidatorCount + 1);
      expect(state.validators.getReadonly(newKeyIndex).withdrawalCredentials).toEqual(
        eth1Deposit.withdrawalCredentials
      );
      expect(state.balances.get(newKeyIndex)).toBe(MIN_ACTIVATION_BALANCE);
      expect(state.pendingDeposits.length).toBe(0);
    });

    it("consumes churn for a skipped deposit", () => {
      const state = createState(ForkName.heze, config);
      const churnLimit = getActivationChurnLimit(state.epochCtx);
      const remainingChurn = 1_000_000_000;
      const blsDeposit = pendingDeposit(config, newKeyIndex, BLS_WITHDRAWAL_PREFIX, churnLimit - remainingChurn);
      const eth1Deposit = pendingDeposit(config, newKeyIndex + 1, ETH1_ADDRESS_WITHDRAWAL_PREFIX);

      runProcessPendingDeposits(state, [blsDeposit, eth1Deposit]);

      expect(state.validators.length).toBe(existingValidatorCount);
      expect(state.pendingDeposits.getAllReadonlyValues()).toEqual([eth1Deposit]);
      expect(state.depositBalanceToConsume).toBe(BigInt(remainingChurn));
    });
  });

  describe("heze fork boundary", () => {
    const config = getConfig(ForkName.heze, 1);

    it("creates a validator with BLS credentials before heze", () => {
      const state = createState(ForkName.gloas, config);
      const deposit = pendingDeposit(config, newKeyIndex, BLS_WITHDRAWAL_PREFIX);

      runProcessPendingDeposits(state, [deposit]);

      expect(state.validators.length).toBe(existingValidatorCount + 1);
      expect(state.validators.getReadonly(newKeyIndex).withdrawalCredentials).toEqual(deposit.withdrawalCredentials);
      expect(state.balances.get(newKeyIndex)).toBe(MIN_ACTIVATION_BALANCE);
    });

    it("skips a deposit queued before heze that is processed after the fork", () => {
      const state = createState(ForkName.heze, config, SLOTS_PER_EPOCH);
      const deposit = pendingDeposit(config, newKeyIndex, BLS_WITHDRAWAL_PREFIX);

      runProcessPendingDeposits(state, [deposit]);

      expect(state.validators.length).toBe(existingValidatorCount);
      expect(state.pendingDeposits.length).toBe(0);
    });
  });
});
