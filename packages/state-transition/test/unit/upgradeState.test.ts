import {describe, expect, it} from "vitest";
import {ChainForkConfig, createBeaconConfig, createChainForkConfig} from "@lodestar/config";
import {config as chainConfig} from "@lodestar/config/default";
import {FAR_FUTURE_EPOCH, ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {createPubkeyCache} from "../../src/cache/pubkeyCache.js";
import {CachedBeaconStateFulu, createCachedBeaconState} from "../../src/cache/stateCache.js";
import {upgradeStateToDeneb} from "../../src/slot/upgradeStateToDeneb.js";
import {upgradeStateToElectra} from "../../src/slot/upgradeStateToElectra.js";
import {upgradeStateToGloas} from "../../src/slot/upgradeStateToGloas.js";

describe("upgradeState", () => {
  it("upgradeStateToDeneb", () => {
    const capellaState = ssz.capella.BeaconState.defaultViewDU();
    const config = getConfig(ForkName.capella);
    const stateView = createCachedBeaconState(
      capellaState,
      {
        config: createBeaconConfig(config, capellaState.genesisValidatorsRoot),
        pubkeyCache: createPubkeyCache(),
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
        pubkeyCache: createPubkeyCache(),
      },
      {skipSyncCommitteeCache: true}
    );
    const newState = upgradeStateToElectra(stateView);
    expect(() => newState.toValue()).not.toThrow();
  });

  it("upgradeStateToGloas reuses composite-list nodes with identical merkle roots", () => {
    // Enough validators to span multiple progressive subtrees (capacities 1, 4, 16, 64, ...) and to
    // populate every slot's committee for the gloas PTC window computed during the upgrade.
    // Not a multiple of itemsPerChunk (4 for uint64, 32 for uint8) so basic-list migration covers
    // a zero-padded partial final chunk.
    const numValidators = 130;
    const fuluStateView = ssz.fulu.BeaconState.defaultViewDU();
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
    for (let i = 0; i < 5; i++) {
      const pendingDeposit = ssz.electra.PendingDeposit.defaultValue();
      pendingDeposit.amount = 1000 + i;
      fuluStateView.pendingDeposits.push(ssz.electra.PendingDeposit.toViewDU(pendingDeposit));
      const pendingPartialWithdrawal = ssz.electra.PendingPartialWithdrawal.defaultValue();
      pendingPartialWithdrawal.amount = BigInt(2000 + i);
      fuluStateView.pendingPartialWithdrawals.push(
        ssz.electra.PendingPartialWithdrawal.toViewDU(pendingPartialWithdrawal)
      );
      const pendingConsolidation = ssz.electra.PendingConsolidation.defaultValue();
      pendingConsolidation.sourceIndex = i;
      fuluStateView.pendingConsolidations.push(ssz.electra.PendingConsolidation.toViewDU(pendingConsolidation));
    }
    fuluStateView.commit();

    const config = getConfig(ForkName.fulu);
    const fuluState = createCachedBeaconState(
      fuluStateView,
      {
        config: createBeaconConfig(config, fuluStateView.genesisValidatorsRoot),
        pubkeyCache: createPubkeyCache(),
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
    // Basic-list leaf reuse must produce byte-identical merkle roots too
    expect(gloasState.balances.hashTreeRoot()).toEqual(expectedBalancesRoot);
    expect(gloasState.balances.getAll()).toEqual(fuluStateView.balances.getAll());
    expect(gloasState.previousEpochParticipation.hashTreeRoot()).toEqual(expectedPreviousEpochParticipationRoot);
    expect(gloasState.currentEpochParticipation.hashTreeRoot()).toEqual(expectedCurrentEpochParticipationRoot);
    expect(gloasState.inactivityScores.hashTreeRoot()).toEqual(expectedInactivityScoresRoot);
    // Full state still merkleizes and round-trips
    expect(() => gloasState.hashTreeRoot()).not.toThrow();
    expect(() => gloasState.toValue()).not.toThrow();
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
  }
}
