import {describe, expect, it} from "vitest";
import {pubkeyCache} from "@chainsafe/lodestar-z/pubkeys";
import {ChainForkConfig, createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as chainConfig} from "@lodestar/config/default";
import {BUILDER_INDEX_SELF_BUILD, FAR_FUTURE_EPOCH, ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {CachedBeaconStateFulu, createCachedBeaconState} from "../../src/cache/stateCache.js";
import {upgradeStateToDeneb} from "../../src/slot/upgradeStateToDeneb.js";
import {upgradeStateToElectra} from "../../src/slot/upgradeStateToElectra.js";
import {upgradeStateToGloas} from "../../src/slot/upgradeStateToGloas.js";
import {generateBuilderPendingDeposits} from "../../src/testUtils/util.js";

describe("upgradeState", () => {
  it("upgradeStateToDeneb", () => {
    const capellaState = ssz.capella.BeaconState.defaultViewDU();
    const config = getConfig(ForkName.capella);
    const stateView = createCachedBeaconState(
      capellaState,
      {
        config: createBeaconConfig(config, capellaState.genesisValidatorsRoot),
        pubkeyCache,
      },
      {skipSyncCommitteeCache: true}
    );
    const newState = upgradeStateToDeneb(stateView);
    expect(() => newState.toValue()).not.toThrow();
  });
  it("upgradeStateToElectra", () => {
    const denebState = ssz.deneb.BeaconState.defaultViewDU();
    const config = getConfig(ForkName.deneb);
    const stateView = createCachedBeaconState(
      denebState,
      {
        config: createBeaconConfig(config, denebState.genesisValidatorsRoot),
        pubkeyCache,
      },
      {skipSyncCommitteeCache: true}
    );
    const newState = upgradeStateToElectra(stateView);
    expect(() => newState.toValue()).not.toThrow();
  });

  it("upgradeStateToGloas reuses list nodes and initializes the latest bid", () => {
    // Enough validators to span multiple progressive subtrees (capacities 1, 4, 16, 64, ...) and to
    // populate every slot's committee for the gloas PTC window computed during the upgrade.
    // Not a multiple of itemsPerChunk (4 for uint64, 32 for uint8) so basic-list migration covers
    // a zero-padded partial final chunk.
    const numValidators = 130;
    const fuluStateView = ssz.fulu.BeaconState.defaultViewDU();
    const latestBlockSlot = 5;
    const latestBlockParentRoot = new Uint8Array(32).fill(0x11);
    const latestPayloadParentHash = new Uint8Array(32).fill(0x22);
    const latestPayloadBlockHash = new Uint8Array(32).fill(0x33);
    const latestPayloadPrevRandao = new Uint8Array(32).fill(0x44);
    const latestPayloadGasLimit = 42_000_000;
    fuluStateView.slot = latestBlockSlot + 3;
    fuluStateView.latestBlockHeader.slot = latestBlockSlot;
    fuluStateView.latestBlockHeader.parentRoot = latestBlockParentRoot;
    fuluStateView.latestExecutionPayloadHeader.parentHash = latestPayloadParentHash;
    fuluStateView.latestExecutionPayloadHeader.blockHash = latestPayloadBlockHash;
    fuluStateView.latestExecutionPayloadHeader.prevRandao = latestPayloadPrevRandao;
    fuluStateView.latestExecutionPayloadHeader.gasLimit = latestPayloadGasLimit;
    for (let i = 0; i < numValidators; i++) {
      const validator = ssz.phase0.Validator.defaultValue();
      // Distinct pubkey/withdrawalCredentials so each validator has a distinct subtree root
      validator.pubkey = Buffer.alloc(48, i + 1);
      validator.withdrawalCredentials = Buffer.alloc(32, i + 1);
      validator.effectiveBalance = 32e9;
      // Active at epoch 0 so shuffling / PTC committee selection has a non-empty validator set
      validator.activationEligibilityEpoch = 0;
      validator.activationEpoch = 0;
      validator.exitEpoch = FAR_FUTURE_EPOCH;
      validator.withdrawableEpoch = FAR_FUTURE_EPOCH;
      fuluStateView.validators.push(ssz.phase0.Validator.toViewDU(validator));
      // Distinct per-index values so basic-list leaf reuse in the wrong order would be caught
      fuluStateView.balances.push(32e9 + i);
      fuluStateView.previousEpochParticipation.push(i % 8);
      fuluStateView.currentEpochParticipation.push((i + 3) % 8);
      fuluStateView.inactivityScores.push(i % 5);
    }

    // Populate the pending* composite queues so the node-reuse path is exercised for them too.
    // Non-builder withdrawal credentials (default zeros) keep the deposits pending in-order.
    // pendingConsolidations is deliberately left EMPTY to cover migrating an empty list
    // (a realistic fork-boundary state) through the same node-reuse path.
    for (let i = 0; i < 5; i++) {
      const pendingDeposit = ssz.electra.PendingDeposit.defaultValue();
      pendingDeposit.amount = 1000 + i;
      fuluStateView.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(pendingDeposit));
      const pendingPartialWithdrawal = ssz.electra.PendingPartialWithdrawal.defaultValue();
      pendingPartialWithdrawal.amount = BigInt(2000 + i);
      fuluStateView.pendingPartialWithdrawals.push(
        ssz.electra.PendingPartialWithdrawal.toViewDU(pendingPartialWithdrawal)
      );
    }
    fuluStateView.commit();

    const config = getConfig(ForkName.fulu);
    const fuluState = createCachedBeaconState(
      fuluStateView,
      {
        config: createBeaconConfig(config, fuluStateView.genesisValidatorsRoot),
        pubkeyCache,
      },
      // dummy pubkeys aren't valid BLS keys; skip syncing (no builder deposits need the cache)
      {skipSyncCommitteeCache: true, skipSyncPubkeys: true}
    ) as CachedBeaconStateFulu;

    // Reference gloas roots via the value-based path (what the node-reuse replaces)
    const expectedValidatorsRoot = ssz.gloas.Validators.hashTreeRoot(fuluState.validators.getAllReadonlyValues());
    const expectedPendingDepositsRoot = ssz.gloas.PendingDeposits.hashTreeRoot(
      fuluState.pendingDeposits.getAllReadonlyValues()
    );
    const expectedPendingPartialWithdrawalsRoot = ssz.gloas.PendingPartialWithdrawals.hashTreeRoot(
      fuluState.pendingPartialWithdrawals.getAllReadonlyValues()
    );
    const expectedPendingConsolidationsRoot = ssz.gloas.PendingConsolidations.hashTreeRoot(
      fuluState.pendingConsolidations.getAllReadonlyValues()
    );
    const expectedBalancesRoot = ssz.gloas.Balances.hashTreeRoot(fuluState.balances.getAll());
    const expectedPreviousEpochParticipationRoot = ssz.gloas.EpochParticipation.hashTreeRoot(
      fuluState.previousEpochParticipation.getAll()
    );
    const expectedCurrentEpochParticipationRoot = ssz.gloas.EpochParticipation.hashTreeRoot(
      fuluState.currentEpochParticipation.getAll()
    );
    const expectedInactivityScoresRoot = ssz.gloas.InactivityScores.hashTreeRoot(fuluState.inactivityScores.getAll());

    const gloasState = upgradeStateToGloas(fuluState);

    // Node-reuse must produce byte-identical merkle roots for every migrated composite list
    expect(gloasState.validators.hashTreeRoot()).toEqual(expectedValidatorsRoot);
    expect(gloasState.validators.length).toEqual(numValidators);
    expect(gloasState.pendingDeposits.hashTreeRoot()).toEqual(expectedPendingDepositsRoot);
    expect(gloasState.pendingPartialWithdrawals.hashTreeRoot()).toEqual(expectedPendingPartialWithdrawalsRoot);
    expect(gloasState.pendingConsolidations.hashTreeRoot()).toEqual(expectedPendingConsolidationsRoot);
    expect(gloasState.pendingConsolidations.length).toBe(0);
    // Basic-list leaf reuse must produce byte-identical merkle roots too
    expect(gloasState.balances.hashTreeRoot()).toEqual(expectedBalancesRoot);
    expect(gloasState.balances.getAll()).toEqual(fuluStateView.balances.getAll());
    expect(gloasState.previousEpochParticipation.hashTreeRoot()).toEqual(expectedPreviousEpochParticipationRoot);
    expect(gloasState.currentEpochParticipation.hashTreeRoot()).toEqual(expectedCurrentEpochParticipationRoot);
    expect(gloasState.inactivityScores.hashTreeRoot()).toEqual(expectedInactivityScoresRoot);
    const latestBid = gloasState.latestExecutionPayloadBid;
    expect(latestBid.parentBlockHash).toEqual(latestPayloadParentHash);
    expect(latestBid.parentBlockRoot).toEqual(latestBlockParentRoot);
    expect(latestBid.blockHash).toEqual(latestPayloadBlockHash);
    expect(latestBid.prevRandao).toEqual(latestPayloadPrevRandao);
    expect(latestBid.feeRecipient).toEqual(ssz.ExecutionAddress.defaultValue());
    expect(latestBid.gasLimit).toBe(BigInt(latestPayloadGasLimit));
    expect(latestBid.builderIndex).toBe(BUILDER_INDEX_SELF_BUILD);
    // Preserve the actual pre-fork block slot when slots were missed before the fork.
    expect(latestBid.slot).toBe(latestBlockSlot);
    expect(latestBid.value).toBe(0);
    expect(latestBid.executionPayment).toBe(0n);
    expect(latestBid.blobKzgCommitments.length).toBe(0);
    expect(latestBid.executionRequestsRoot).toEqual(
      ssz.gloas.ExecutionRequests.hashTreeRoot(ssz.gloas.ExecutionRequests.defaultValue())
    );
    // Full state still merkleizes and round-trips
    expect(() => gloasState.hashTreeRoot()).not.toThrow();
    expect(() => gloasState.toValue()).not.toThrow();
  });

  it("upgradeStateToGloas onboards builders using the pre-verified signature cache", () => {
    const forkConfig = getConfig(ForkName.fulu);
    const beaconConfig = createBeaconConfig(forkConfig, ZERO_HASH);

    const fuluStateView = ssz.fulu.BeaconState.defaultViewDU();
    // Some active validators so shuffling / PTC-window init have a non-empty set.
    for (let i = 0; i < 64; i++) {
      const validator = ssz.phase0.Validator.defaultValue();
      validator.pubkey = Buffer.alloc(48, i + 1);
      validator.withdrawalCredentials = Buffer.alloc(32, i + 1);
      validator.effectiveBalance = 32e9;
      validator.activationEligibilityEpoch = 0;
      validator.activationEpoch = 0;
      validator.exitEpoch = FAR_FUTURE_EPOCH;
      validator.withdrawableEpoch = FAR_FUTURE_EPOCH;
      fuluStateView.validators.push(ssz.phase0.Validator.toViewDU(validator));
      fuluStateView.balances.push(32e9);
    }

    // 3 validly-signed builder deposits (distinct interop pubkeys). We drive each down a different
    // consumption path via the cache: [0] cached true, [1] cached false, [2] a cache miss.
    const builderDeposits = generateBuilderPendingDeposits(beaconConfig, 3, 1000);
    for (const deposit of builderDeposits) {
      fuluStateView.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(deposit));
    }
    fuluStateView.commit();

    const fuluState = createCachedBeaconState(
      fuluStateView,
      {config: beaconConfig, pubkeyCache},
      {skipSyncCommitteeCache: true, skipSyncPubkeys: true}
    ) as CachedBeaconStateFulu;

    // Pre-populate the cache by value-object identity — the same node.value the migration carries
    // into the gloas pendingDeposits, so onboardBuildersFromPendingDeposits hits by identity.
    const cache = fuluState.epochCtx.builderDepositSignatureCache;
    const [d0, d1] = fuluState.pendingDeposits.getAllReadonlyValues();
    cache.setSignatureValidity(d0, true); // cached valid → onboard without re-verifying
    cache.setSignatureValidity(d1, false); // cached invalid → dropped
    // builderDeposits[2] left uncached → miss → fallback verifies its (valid) signature → onboard

    const gloasState = upgradeStateToGloas(fuluState);

    // [0] (cached true) and [2] (miss, valid) onboarded; [1] (cached false) dropped
    const onboarded = gloasState.builders.getAllReadonlyValues().map((b) => Buffer.from(b.pubkey).toString("hex"));
    expect(onboarded).toContain(Buffer.from(builderDeposits[0].pubkey).toString("hex"));
    expect(onboarded).toContain(Buffer.from(builderDeposits[2].pubkey).toString("hex"));
    expect(onboarded).not.toContain(Buffer.from(builderDeposits[1].pubkey).toString("hex"));
    expect(gloasState.builders.length).toBe(2);
    // all builder deposits consumed from the pending queue
    expect(gloasState.pendingDeposits.length).toBe(0);
    // (d) the fork transition does NOT clear the cache — prepareNextSlot drops it on finalization
    expect(cache.cachedDepositCount).toBe(2);
  });
});

const ZERO_HASH = Buffer.alloc(32, 0);
/** default config with ZERO_HASH as genesisValidatorsRoot */
const config = createBeaconConfig(chainConfig, ZERO_HASH);

function getConfig(fork: ForkName, forkEpoch = 0): ChainForkConfig {
  switch (fork) {
    case ForkName.phase0:
      return config;
    case ForkName.altair:
      return createChainForkConfig({ALTAIR_FORK_EPOCH: forkEpoch});
    case ForkName.bellatrix:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: forkEpoch,
      });
    case ForkName.capella:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: forkEpoch,
      });
    case ForkName.deneb:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: forkEpoch,
      });
    case ForkName.electra:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: forkEpoch,
      });
    case ForkName.fulu:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: forkEpoch,
      });
    case ForkName.gloas:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: forkEpoch,
      });
    case ForkName.eip8198:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: 0,
        EIP8198_FORK_EPOCH: forkEpoch,
      });
    case ForkName.heze:
      return createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
        FULU_FORK_EPOCH: 0,
        GLOAS_FORK_EPOCH: 0,
        EIP8198_FORK_EPOCH: 0,
        SLOT_DURATION_MS_EIP8198: chainConfig.SLOT_DURATION_MS,
        HEZE_FORK_EPOCH: forkEpoch,
      });
  }
}
