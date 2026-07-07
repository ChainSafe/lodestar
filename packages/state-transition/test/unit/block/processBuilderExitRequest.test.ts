import {describe, expect, it} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {FAR_FUTURE_EPOCH, ForkName, PAYLOAD_BUILDER_WITHDRAWAL_PREFIX, SLOTS_PER_EPOCH} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {processBuilderExitRequest} from "../../../src/block/processBuilderExitRequest.js";
import {createCachedBeaconState, createPubkeyCache} from "../../../src/index.js";

function buildGloasState({slot = 0, finalizedEpoch = 0}: {slot?: number; finalizedEpoch?: number} = {}) {
  const config = getConfig(ForkName.gloas);
  const view = ssz.gloas.BeaconState.defaultViewDU();
  view.slot = slot;
  view.fork = ssz.phase0.Fork.toViewDU({
    previousVersion: config.GENESIS_FORK_VERSION,
    currentVersion: config.GLOAS_FORK_VERSION,
    epoch: 0,
  });
  view.finalizedCheckpoint = ssz.phase0.Checkpoint.toViewDU({
    epoch: finalizedEpoch,
    root: new Uint8Array(32),
  });
  const state = createCachedBeaconState(
    view,
    {
      config: createBeaconConfig(config, view.genesisValidatorsRoot),
      pubkeyCache: createPubkeyCache(),
    },
    {skipSyncCommitteeCache: true}
  );
  return {state, config: state.config};
}

const PUBKEY = Uint8Array.from({length: 48}, (_, i) => i + 1);
const EXEC_ADDRESS = Uint8Array.from({length: 20}, (_, i) => i + 1);
const OTHER_EXEC_ADDRESS = Uint8Array.from({length: 20}, () => 0xff);

function pushBuilder(
  state: ReturnType<typeof buildGloasState>["state"],
  {
    pubkey = PUBKEY,
    executionAddress = EXEC_ADDRESS,
    depositEpoch = 0,
    withdrawableEpoch = FAR_FUTURE_EPOCH,
    balance = 32_000_000_000,
  }: {
    pubkey?: Uint8Array;
    executionAddress?: Uint8Array;
    depositEpoch?: number;
    withdrawableEpoch?: number;
    balance?: number;
  } = {}
) {
  state.builders.push(
    ssz.gloas.Builder.toViewDU({
      pubkey,
      version: PAYLOAD_BUILDER_WITHDRAWAL_PREFIX,
      executionAddress,
      balance,
      depositEpoch,
      withdrawableEpoch,
    })
  );
}

function exitRequest({
  pubkey = PUBKEY,
  sourceAddress = EXEC_ADDRESS,
}: {
  pubkey?: Uint8Array;
  sourceAddress?: Uint8Array;
} = {}) {
  return {pubkey, sourceAddress};
}

describe("processBuilderExitRequest", () => {
  it("drops request for unknown builder pubkey", () => {
    const {state} = buildGloasState();

    processBuilderExitRequest(state, exitRequest());

    expect(state.builders.length).toBe(0);
  });

  it("drops request for inactive builder", () => {
    // isActiveBuilder requires `depositEpoch < finalizedEpoch`. With finalizedEpoch = 0 the
    // freshly registered builder is still pending and exit requests must be silently dropped.
    const {state} = buildGloasState({finalizedEpoch: 0});
    pushBuilder(state, {depositEpoch: 0});

    processBuilderExitRequest(state, exitRequest());

    expect(state.builders.get(0).withdrawableEpoch).toBe(FAR_FUTURE_EPOCH);
  });

  it("drops request when source address does not match registered execution address", () => {
    const {state} = buildGloasState({finalizedEpoch: 5});
    pushBuilder(state, {depositEpoch: 0});

    processBuilderExitRequest(state, exitRequest({sourceAddress: OTHER_EXEC_ADDRESS}));

    expect(state.builders.get(0).withdrawableEpoch).toBe(FAR_FUTURE_EPOCH);
  });

  it("drops request when builder has pending balance to withdraw", () => {
    const {state} = buildGloasState({finalizedEpoch: 5});
    pushBuilder(state, {depositEpoch: 0});

    state.builderPendingWithdrawals.push(
      ssz.gloas.BuilderPendingWithdrawal.toViewDU({
        feeRecipient: EXEC_ADDRESS,
        amount: 1_000_000_000,
        builderIndex: 0,
      })
    );

    processBuilderExitRequest(state, exitRequest());

    expect(state.builders.get(0).withdrawableEpoch).toBe(FAR_FUTURE_EPOCH);
  });

  it("initiates exit for an active builder when source address matches", () => {
    // slot=SLOTS_PER_EPOCH * 3 → currentEpoch=3; +MIN_BUILDER_WITHDRAWABILITY_DELAY = 2 (minimal preset)
    const currentEpoch = 3;
    const {state, config} = buildGloasState({slot: SLOTS_PER_EPOCH * currentEpoch, finalizedEpoch: 5});
    pushBuilder(state, {depositEpoch: 0});

    processBuilderExitRequest(state, exitRequest());

    expect(state.builders.get(0).withdrawableEpoch).toBe(currentEpoch + config.MIN_BUILDER_WITHDRAWABILITY_DELAY);
  });
});
