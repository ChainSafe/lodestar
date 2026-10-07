import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {ChainForkConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {
  BLS_WITHDRAWAL_PREFIX,
  COMPOUNDING_WITHDRAWAL_PREFIX,
  DOMAIN_DEPOSIT,
  ETH1_ADDRESS_WITHDRAWAL_PREFIX,
  ForkName,
  ForkSeq,
  MIN_ACTIVATION_BALANCE,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import * as depositProcessing from "../../../src/block/processDeposit.js";
import {beforeProcessEpoch} from "../../../src/cache/epochTransitionCache.js";
import {ZERO_HASH} from "../../../src/constants/index.js";
import {processPendingDeposits} from "../../../src/epoch/processPendingDeposits.js";
import {upgradeStateToHeze} from "../../../src/slot/upgradeStateToHeze.js";
import {createCachedBeaconStateTest} from "../../../src/testUtils/state.js";
import {generateValidatorPendingDeposit} from "../../../src/testUtils/util.js";
import {
  CachedBeaconStateAllForks,
  CachedBeaconStateElectra,
  CachedBeaconStateGloas,
  CachedBeaconStateHeze,
} from "../../../src/types.js";
import {computeDomain} from "../../../src/util/domain.js";
import {interopSecretKey} from "../../../src/util/interop.js";
import {computeSigningRoot} from "../../../src/util/signingRoot.js";
import {getActivationChurnLimit} from "../../../src/util/validator.js";

function buildState(
  fork: ForkName.gloas | ForkName.heze = ForkName.heze,
  config: ChainForkConfig = getConfig(fork),
  slot = 0
) {
  const view = ssz[fork].BeaconState.defaultViewDU();
  view.slot = slot;
  return createCachedBeaconStateTest(view, config, {skipSyncCommitteeCache: true});
}

function createDeposit(
  state: CachedBeaconStateGloas | CachedBeaconStateHeze,
  prefix = BLS_WITHDRAWAL_PREFIX,
  amount = MIN_ACTIVATION_BALANCE
) {
  const deposit = generateValidatorPendingDeposit(state.config, 0, amount);
  deposit.withdrawalCredentials[0] = prefix;
  const domain = computeDomain(DOMAIN_DEPOSIT, state.config.GENESIS_FORK_VERSION, ZERO_HASH);
  deposit.signature = interopSecretKey(0)
    .sign(computeSigningRoot(ssz.phase0.DepositMessage, deposit, domain))
    .toBytes();
  return deposit;
}

function processDeposits(state: CachedBeaconStateAllForks) {
  state.commit();
  const cache = beforeProcessEpoch(state);
  cache.balances = state.balances.getAll();
  processPendingDeposits(state as CachedBeaconStateElectra, cache);
  return cache;
}

describe("processPendingDeposits in Heze", () => {
  beforeEach(() => pubkeyCache.reset());
  afterEach(() => vi.restoreAllMocks());

  it.each([true, false])("skips a new BLS validator with valid signature = %s", (validSignature) => {
    const state = buildState();
    const deposit = createDeposit(state);
    if (!validSignature) deposit.signature = Buffer.alloc(96);
    expect(
      depositProcessing.isValidDepositSignature(
        state.config,
        deposit.pubkey,
        deposit.withdrawalCredentials,
        deposit.amount,
        deposit.signature
      )
    ).toBe(validSignature);
    const verifySignature = vi.spyOn(depositProcessing, "isValidDepositSignature");
    state.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(deposit));

    const cache = processDeposits(state);

    expect(verifySignature).not.toHaveBeenCalled();
    expect(state.validators.length).toBe(0);
    expect(state.balances.length).toBe(0);
    expect(cache.balances).toEqual([]);
    expect(cache.isCompoundingValidatorArr).toEqual([]);
    expect(state.pendingDeposits.length).toBe(0);
    expect(state.depositBalanceToConsume).toBe(0n);
  });

  it.each([true, false])("tops up an existing BLS validator with valid signature = %s", (validSignature) => {
    const state = buildState();
    const deposit = createDeposit(state);
    depositProcessing.addValidatorToRegistry(
      ForkSeq.electra,
      state,
      deposit.pubkey,
      deposit.withdrawalCredentials,
      MIN_ACTIVATION_BALANCE
    );
    if (!validSignature) deposit.signature = Buffer.alloc(96);
    const verifySignature = vi.spyOn(depositProcessing, "isValidDepositSignature");
    state.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(deposit));

    const cache = processDeposits(state);

    expect(verifySignature).not.toHaveBeenCalled();
    expect(state.validators.length).toBe(1);
    expect(state.validators.getReadonly(0).withdrawalCredentials).toEqual(deposit.withdrawalCredentials);
    expect(state.balances.get(0)).toBe(2 * MIN_ACTIVATION_BALANCE);
    expect(cache.balances).toEqual([2 * MIN_ACTIVATION_BALANCE]);
    expect(state.pendingDeposits.length).toBe(0);
  });

  it.each([ETH1_ADDRESS_WITHDRAWAL_PREFIX, COMPOUNDING_WITHDRAWAL_PREFIX])(
    "creates a new validator with withdrawal prefix %i",
    (prefix) => {
      const state = buildState();
      const deposit = createDeposit(state, prefix);
      state.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(deposit));

      const cache = processDeposits(state);

      expect(state.validators.length).toBe(1);
      expect(state.validators.getReadonly(0).withdrawalCredentials).toEqual(deposit.withdrawalCredentials);
      expect(state.balances.get(0)).toBe(MIN_ACTIVATION_BALANCE);
      expect(cache.balances).toEqual([MIN_ACTIVATION_BALANCE]);
      expect(cache.isCompoundingValidatorArr).toEqual([prefix === COMPOUNDING_WITHDRAWAL_PREFIX]);
      expect(state.pendingDeposits.length).toBe(0);
    }
  );

  it("creates the validator from an execution deposit following a skipped BLS deposit for the same pubkey", () => {
    const state = buildState();
    const blsDeposit = createDeposit(state);
    const executionDeposit = createDeposit(state, ETH1_ADDRESS_WITHDRAWAL_PREFIX);
    state.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(blsDeposit));
    state.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(executionDeposit));

    const cache = processDeposits(state);

    expect(state.validators.length).toBe(1);
    expect(state.validators.getReadonly(0).withdrawalCredentials).toEqual(executionDeposit.withdrawalCredentials);
    expect(state.balances.get(0)).toBe(MIN_ACTIVATION_BALANCE);
    expect(cache.balances).toEqual([MIN_ACTIVATION_BALANCE]);
    expect(state.pendingDeposits.length).toBe(0);
  });

  it("applies a BLS top-up after creating an execution validator for the same pubkey", () => {
    const state = buildState();
    const executionDeposit = createDeposit(state, ETH1_ADDRESS_WITHDRAWAL_PREFIX);
    const blsDeposit = {...createDeposit(state), signature: Buffer.alloc(96)};
    state.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(executionDeposit));
    state.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(blsDeposit));

    const cache = processDeposits(state);

    expect(state.validators.length).toBe(1);
    expect(state.validators.getReadonly(0).withdrawalCredentials).toEqual(executionDeposit.withdrawalCredentials);
    expect(state.balances.get(0)).toBe(2 * MIN_ACTIVATION_BALANCE);
    expect(cache.balances).toEqual([2 * MIN_ACTIVATION_BALANCE]);
    expect(state.pendingDeposits.length).toBe(0);
  });

  it("still consumes churn for skipped BLS deposits", () => {
    const state = buildState();
    const churnLimit = getActivationChurnLimit(state.epochCtx);
    const blsDeposit = createDeposit(state, BLS_WITHDRAWAL_PREFIX, churnLimit - MIN_ACTIVATION_BALANCE);
    const executionDeposit = createDeposit(state, ETH1_ADDRESS_WITHDRAWAL_PREFIX, 2 * MIN_ACTIVATION_BALANCE);
    state.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(blsDeposit));
    state.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(executionDeposit));

    processDeposits(state);

    expect(state.validators.length).toBe(0);
    expect(state.pendingDeposits.getAllReadonlyValues()).toEqual([executionDeposit]);
    expect(state.depositBalanceToConsume).toBe(BigInt(MIN_ACTIVATION_BALANCE));

    processDeposits(state);

    expect(state.validators.length).toBe(1);
    expect(state.balances.get(0)).toBe(executionDeposit.amount);
    expect(state.pendingDeposits.length).toBe(0);
    expect(state.depositBalanceToConsume).toBe(0n);
  });

  it("skips a BLS deposit queued before the Heze upgrade", () => {
    const preState = buildState(ForkName.gloas, getConfig(ForkName.heze, 1), SLOTS_PER_EPOCH);
    preState.depositRequestsStartIndex = BigInt(preState.eth1DepositIndex);
    const deposit = createDeposit(preState);
    preState.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(deposit));
    const state = upgradeStateToHeze(preState as CachedBeaconStateGloas);

    processDeposits(state);

    expect(state.validators.length).toBe(0);
    expect(state.balances.length).toBe(0);
    expect(state.pendingDeposits.length).toBe(0);
  });

  it("still creates a new BLS validator in Gloas", () => {
    const state = buildState(ForkName.gloas);
    const deposit = createDeposit(state);
    state.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(deposit));

    processDeposits(state);

    expect(state.validators.length).toBe(1);
    expect(state.validators.getReadonly(0).withdrawalCredentials).toEqual(deposit.withdrawalCredentials);
    expect(state.balances.get(0)).toBe(MIN_ACTIVATION_BALANCE);
    expect(state.pendingDeposits.length).toBe(0);
  });
});
