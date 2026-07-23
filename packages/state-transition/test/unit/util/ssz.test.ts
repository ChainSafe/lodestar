import {describe, expect, it} from "vitest";
import {ssz} from "@lodestar/types";
import {zeroProgressiveListBasicRootNode} from "../../../src/util/ssz.js";

describe("zeroProgressiveListBasicRootNode", () => {
  // EpochParticipation is ProgressiveList[ParticipationFlags] (uint8) → 32 items per chunk.
  // Progressive subtree chunk capacities are 1, 4, 16, 64, ... so cumulative chunk counts are
  // 1, 5, 21, 85, ... = 32, 160, 672, 2720 items. Test lengths around every boundary.
  const lengths = [0, 1, 31, 32, 33, 160, 161, 671, 672, 673, 2720];

  for (const length of lengths) {
    it(`equals naive zero-filled list length=${length}`, () => {
      const fastView = ssz.gloas.EpochParticipation.getViewDU(
        zeroProgressiveListBasicRootNode(ssz.gloas.EpochParticipation.itemsPerChunk, length)
      );
      const naiveView = ssz.gloas.EpochParticipation.toViewDU(new Array<number>(length).fill(0));

      expect(fastView.length).toBe(length);
      expect(fastView.hashTreeRoot()).toEqual(naiveView.hashTreeRoot());
      expect(fastView.serialize()).toEqual(naiveView.serialize());
    });
  }

  it("produces a mutable view backed by shared zero nodes", () => {
    const length = 673;
    const fastView = ssz.gloas.EpochParticipation.getViewDU(
      zeroProgressiveListBasicRootNode(ssz.gloas.EpochParticipation.itemsPerChunk, length)
    );
    const naiveView = ssz.gloas.EpochParticipation.toViewDU(new Array<number>(length).fill(0));

    for (const view of [fastView, naiveView]) {
      view.set(0, 7);
      view.set(Math.floor(length / 2), 3);
      view.set(length - 1, 1);
      view.push(5);
      view.commit();
    }

    expect(fastView.getAll()).toEqual(naiveView.getAll());
    expect(fastView.hashTreeRoot()).toEqual(naiveView.hashTreeRoot());
  });

  it("does not mutate shared zero nodes across views", () => {
    const length = 100;
    const viewA = ssz.gloas.EpochParticipation.getViewDU(
      zeroProgressiveListBasicRootNode(ssz.gloas.EpochParticipation.itemsPerChunk, length)
    );
    const viewB = ssz.gloas.EpochParticipation.getViewDU(
      zeroProgressiveListBasicRootNode(ssz.gloas.EpochParticipation.itemsPerChunk, length)
    );

    viewA.set(50, 7);
    viewA.commit();

    expect(viewA.get(50)).toBe(7);
    expect(viewB.get(50)).toBe(0);
    expect(viewB.getAll()).toEqual(new Array<number>(length).fill(0));
  });
});
