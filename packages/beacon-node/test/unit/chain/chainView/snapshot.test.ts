import {describe, expect, it} from "vitest";
import {CheckpointWithHex, PayloadStatus} from "@lodestar/fork-choice";
import {toRootHex} from "@lodestar/utils";
import {BeaconEngineCore} from "../../../../src/chain/beaconEngine/beaconEngineCore.js";
import {ReplicateChainView} from "../../../../src/chain/chainView/replicateChainView.js";
import {zeroProtoBlock} from "../../../utils/state.js";

function setup() {
  const root = Buffer.alloc(32, 1);
  const anchor = {...zeroProtoBlock, blockRoot: toRootHex(root)};
  const checkpoint: CheckpointWithHex = {epoch: 0, root, rootHex: anchor.blockRoot};
  const pending = {
    ...anchor,
    blockRoot: toRootHex(Buffer.alloc(32, 2)),
    parentRoot: anchor.blockRoot,
    slot: 1,
    payloadStatus: PayloadStatus.PENDING,
  };
  const empty = {...pending, payloadStatus: PayloadStatus.EMPTY};
  const full = {...pending, payloadStatus: PayloadStatus.FULL};
  const core = Object.assign(Object.create(BeaconEngineCore.prototype) as BeaconEngineCore, {
    forkChoice: {
      getAllNodes: () => [anchor, pending, empty, full],
      getHead: () => full,
      getJustifiedCheckpoint: () => checkpoint,
      getFinalizedCheckpoint: () => checkpoint,
    },
  });
  return {core, anchor, checkpoint, pending, empty, full};
}

describe("ChainView startup snapshot", () => {
  it("preserves every payload variant", async () => {
    const {core, anchor, pending, empty, full} = setup();
    const snapshot = await core.getChainViewSnapshot();
    const view = new ReplicateChainView(snapshot);
    expect(snapshot.blocks.map(({blockRoot, payloadStatus}) => [blockRoot, payloadStatus])).toEqual([
      [anchor.blockRoot, anchor.payloadStatus],
      [pending.blockRoot, PayloadStatus.PENDING],
      [empty.blockRoot, PayloadStatus.EMPTY],
      [full.blockRoot, PayloadStatus.FULL],
    ]);
    for (const variant of [pending, empty, full]) {
      expect(
        view.getBlockHex(variant.blockRoot, variant.payloadStatus),
        `variant ${variant.payloadStatus}`
      ).not.toBeNull();
    }
  });

  it("does not read execution status, timing, or fork-choice diagnostic fields", async () => {
    const {core, anchor} = setup();
    for (const field of [
      "executionStatus",
      "dataAvailabilityStatus",
      "finalizedEpoch",
      "finalizedRoot",
      "timeliness",
      "importedTimely",
      "weight",
      "bestChild",
      "bestDescendant",
    ]) {
      Object.defineProperty(anchor, field, {
        get: () => {
          throw Error(`ChainView accessed ${field}`);
        },
      });
    }
    const snapshot = await core.getChainViewSnapshot();
    expect(snapshot.blocks[0]).not.toHaveProperty("executionStatus");
    expect(snapshot.blocks[0]).not.toHaveProperty("finalizedEpoch");
    expect(snapshot.blocks[0]).not.toHaveProperty("timeliness");
    expect(snapshot.head).not.toHaveProperty("importedTimely");
  });
});
