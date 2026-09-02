import {describe, expect, it, vi} from "vitest";
import {EMPTY_SIGNATURE, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {computeNewStateRoot} from "../../../../src/chain/produceBlock/computeNewStateRoot.js";

describe("computeNewStateRoot", () => {
  it("delegates to the state view with a signed block and bytes", () => {
    const block = ssz.phase0.BeaconBlock.defaultValue();
    const blockBytes = new Uint8Array([1, 2, 3]);
    const expectedResult = {
      newStateRoot: new Uint8Array(32),
      proposerReward: 1n,
      postState: {} as IBeaconStateView,
    };
    const computeNewStateRootMock = vi.fn(() => expectedResult);
    const state = {computeNewStateRoot: computeNewStateRootMock} as unknown as IBeaconStateView;

    const result = computeNewStateRoot(null, state, block, blockBytes);

    expect(result).toBe(expectedResult);
    expect(computeNewStateRootMock).toHaveBeenCalledWith(
      {block: {message: block, signature: EMPTY_SIGNATURE}, ssz: blockBytes},
      {metrics: null}
    );
  });
});
