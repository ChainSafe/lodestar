import {describe, expect, it, vi} from "vitest";
import {EMPTY_SIGNATURE, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {computeNewStateRoot} from "../../../../src/chain/produceBlock/computeNewStateRoot.js";

describe("computeNewStateRoot", () => {
  it("delegates to the state view with a signed block", () => {
    const block = ssz.phase0.BeaconBlock.defaultValue();
    const viewResult = {
      newStateRoot: new Uint8Array(32),
      proposerReward: 1n,
      postState: {} as IBeaconStateView,
      hashTreeRootTime: 0.01,
    };
    const computeNewStateRootMock = vi.fn(() => viewResult);
    const state = {computeNewStateRoot: computeNewStateRootMock} as unknown as IBeaconStateView;

    const result = computeNewStateRoot(null, state, block);

    expect(result).toEqual({
      newStateRoot: viewResult.newStateRoot,
      proposerReward: viewResult.proposerReward,
      postState: viewResult.postState,
    });
    expect(computeNewStateRootMock).toHaveBeenCalledWith(
      {block: {message: block, signature: EMPTY_SIGNATURE}},
      {metrics: undefined}
    );
  });
});
