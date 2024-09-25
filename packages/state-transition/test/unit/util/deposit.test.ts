import {describe, it, expect} from "vitest";
import {ssz} from "@lodestar/types";
import {createChainForkConfig} from "@lodestar/config";
import {MAX_DEPOSITS} from "@lodestar/params";
import {getEth1DepositCount} from "../../../src/index.js";
import {createCachedBeaconStateTest} from "../../utils/state.js";

describe("getEth1DepositCount", () => {
  it("Pre Electra", () => {
    const stateView = ssz.altair.BeaconState.defaultViewDU();
    const preElectraState = createCachedBeaconStateTest(stateView);

    if (preElectraState.epochCtx.isPostElectra()) {
      throw Error("Not a pre-Electra state");
    }

    preElectraState.eth1Data.depositCount = 123;

    // 1. Should get less than MAX_DEPOSIT
    preElectraState.eth1DepositIndex = 120;
    expect(getEth1DepositCount(preElectraState)).toBe(3);

    // 2. Should get MAX_DEPOSIT
    preElectraState.eth1DepositIndex = 100;
    expect(getEth1DepositCount(preElectraState)).toBe(MAX_DEPOSITS);
  });
  it("Post Electra with eth1 deposit", () => {
    const stateView = ssz.electra.BeaconState.defaultViewDU();
    const postElectraState = createCachedBeaconStateTest(
      stateView,
      createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
      }),
      {skipSyncCommitteeCache: true, skipSyncPubkeys: true}
    );

    if (!postElectraState.epochCtx.isPostElectra()) {
      throw Error("Not a post-Electra state");
    }

    postElectraState.depositRequestsStartIndex = 1000n;
    postElectraState.eth1Data.depositCount = 995;

    // 1. Should get less than MAX_DEPOSIT
    postElectraState.eth1DepositIndex = 990;
    expect(getEth1DepositCount(postElectraState)).toBe(5);

    // 2. Should get MAX_DEPOSIT
    postElectraState.eth1DepositIndex = 100;
    expect(getEth1DepositCount(postElectraState)).toBe(MAX_DEPOSITS);

    // 3. Should be 0
    postElectraState.eth1DepositIndex = 1000;
    expect(getEth1DepositCount(postElectraState)).toBe(0);
  });
  it("Post Electra without eth1 deposit", () => {
    const stateView = ssz.electra.BeaconState.defaultViewDU();
    const postElectraState = createCachedBeaconStateTest(
      stateView,
      createChainForkConfig({
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        ELECTRA_FORK_EPOCH: 0,
      }),
      {skipSyncCommitteeCache: true, skipSyncPubkeys: true}
    );

    if (!postElectraState.epochCtx.isPostElectra()) {
      throw Error("Not a post-Electra state");
    }

    postElectraState.depositRequestsStartIndex = 1000n;
    postElectraState.eth1Data.depositCount = 1005;

    // Before eth1DepositIndex reaching the start index
    // 1. Should get less than MAX_DEPOSIT
    postElectraState.eth1DepositIndex = 990;
    expect(getEth1DepositCount(postElectraState)).toBe(10);

    // 2. Should get MAX_DEPOSIT
    postElectraState.eth1DepositIndex = 983;
    expect(getEth1DepositCount(postElectraState)).toBe(MAX_DEPOSITS);

    // After eth1DepositIndex reaching the start index
    // 1. Should be 0
    postElectraState.eth1DepositIndex = 1000;
    expect(getEth1DepositCount(postElectraState)).toBe(0);
    postElectraState.eth1DepositIndex = 1003;
    expect(getEth1DepositCount(postElectraState)).toBe(0);
  });
});
