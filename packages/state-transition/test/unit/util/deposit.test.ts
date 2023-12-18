import {describe, it, expect} from "vitest";
import {ssz} from "@lodestar/types";
import {createChainForkConfig} from "@lodestar/config";
import {MAX_DEPOSITS} from "@lodestar/params";
import {CachedBeaconStateEIP6110, getEth1DepositCount} from "../../../src/index.js";
import {createCachedBeaconStateTest} from "../../utils/state.js";

describe("getEth1DepositCount", () => {
  it("Pre 6110", () => {
    const stateView = ssz.altair.BeaconState.defaultViewDU();
    const pre6110State = createCachedBeaconStateTest(stateView);

    if (pre6110State.epochCtx.isAfterEIP6110()) {
      throw Error("Not a pre-6110 state");
    }

    pre6110State.eth1Data.depositCount = 123;

    // 1. Should get less than MAX_DEPOSIT
    pre6110State.eth1DepositIndex = 120;
    expect(getEth1DepositCount(pre6110State)).toBe(3);

    // 2. Should get MAX_DEPOSIT
    pre6110State.eth1DepositIndex = 100;
    expect(getEth1DepositCount(pre6110State)).toBe(MAX_DEPOSITS);
  });
  it("Post 6110 with eth1 deposit", () => {
    const stateView = ssz.eip6110.BeaconState.defaultViewDU();
    const post6110State = createCachedBeaconStateTest(
      stateView,
      createChainForkConfig({
        /* eslint-disable @typescript-eslint/naming-convention */
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        EIP6110_FORK_EPOCH: 0,
      }),
      {skipSyncCommitteeCache: true, skipSyncPubkeys: true}
    ) as CachedBeaconStateEIP6110;

    if (!post6110State.epochCtx.isAfterEIP6110()) {
      throw Error("Not a post-6110 state");
    }

    post6110State.depositReceiptsStartIndex = 1000n;
    post6110State.eth1Data.depositCount = 995;

    // 1. Should get less than MAX_DEPOSIT
    post6110State.eth1DepositIndex = 990;
    expect(getEth1DepositCount(post6110State)).toBe(5);

    // 2. Should get MAX_DEPOSIT
    post6110State.eth1DepositIndex = 100;
    expect(getEth1DepositCount(post6110State)).toBe(MAX_DEPOSITS);

    // 3. Should be 0
    post6110State.eth1DepositIndex = 1000;
    expect(getEth1DepositCount(post6110State)).toBe(0);
  });
  it("Post 6110 without eth1 deposit", () => {
    const stateView = ssz.eip6110.BeaconState.defaultViewDU();
    const post6110State = createCachedBeaconStateTest(
      stateView,
      createChainForkConfig({
        /* eslint-disable @typescript-eslint/naming-convention */
        ALTAIR_FORK_EPOCH: 0,
        BELLATRIX_FORK_EPOCH: 0,
        CAPELLA_FORK_EPOCH: 0,
        DENEB_FORK_EPOCH: 0,
        EIP6110_FORK_EPOCH: 0,
      }),
      {skipSyncCommitteeCache: true, skipSyncPubkeys: true}
    ) as CachedBeaconStateEIP6110;

    if (!post6110State.epochCtx.isAfterEIP6110()) {
      throw Error("Not a post-6110 state");
    }

    post6110State.depositReceiptsStartIndex = 1000n;
    post6110State.eth1Data.depositCount = 1005;

    // Before eth1DepositIndex reaching the start index
    // 1. Should get less than MAX_DEPOSIT
    post6110State.eth1DepositIndex = 990;
    expect(getEth1DepositCount(post6110State)).toBe(10);

    // 2. Should get MAX_DEPOSIT
    post6110State.eth1DepositIndex = 983;
    expect(getEth1DepositCount(post6110State)).toBe(MAX_DEPOSITS);

    // After eth1DepositIndex reaching the start index
    // 1. Should be 0
    post6110State.eth1DepositIndex = 1000;
    expect(getEth1DepositCount(post6110State)).toBe(0);
    post6110State.eth1DepositIndex = 1003;
    expect(getEth1DepositCount(post6110State)).toBe(0);
  });
});
