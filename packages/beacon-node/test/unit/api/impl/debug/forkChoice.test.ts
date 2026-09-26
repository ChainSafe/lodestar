import {strict as assert} from "node:assert";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {ExecutionStatus, ProtoArray} from "@lodestar/fork-choice";
import {ZERO_HASH_HEX} from "@lodestar/params";
import {DataAvailabilityStatus} from "@lodestar/state-transition";
import {getDebugApi} from "../../../../../src/api/impl/debug/index.js";
import {ApiTestModules, getApiTestModules} from "../../../../utils/api.js";
import {generateProtoBlock} from "../../../../utils/typeGenerator.js";

const root = (byte: number): string => `0x${byte.toString(16).padStart(2, "0").repeat(32)}`;

describe("getDebugForkChoiceV2", () => {
  let modules: ApiTestModules;
  let protoArray: ProtoArray;
  let api: ReturnType<typeof getDebugApi>;

  beforeEach(() => {
    modules = getApiTestModules();
    api = getDebugApi(modules);
    protoArray = ProtoArray.initialize(generateProtoBlock({blockRoot: root(1)}), 0);
    const checkpoint = {epoch: 0, root: new Uint8Array(32), rootHex: ZERO_HASH_HEX};
    modules.forkChoice.getAllNodes = vi.fn(() => protoArray.nodes);
    modules.forkChoice.getPTCVoteCounts = vi.fn((blockRoot) => protoArray.getPTCVoteCounts(blockRoot));
    modules.forkChoice.getJustifiedCheckpoint = vi.fn(() => checkpoint);
    modules.forkChoice.getFinalizedCheckpoint.mockReturnValue(checkpoint);
    modules.forkChoice.getUnrealizedJustifiedCheckpoint = vi.fn(() => checkpoint);
    modules.forkChoice.getUnrealizedFinalizedCheckpoint = vi.fn(() => checkpoint);
    modules.forkChoice.getProposerBoostRoot = vi.fn(() => ZERO_HASH_HEX);
    modules.forkChoice.getPreviousProposerBoostRoot = vi.fn(() => ZERO_HASH_HEX);
    modules.forkChoice.getHeadRoot.mockReturnValue(ZERO_HASH_HEX);
  });

  it("returns parent roots and statuses, execution hashes and PTC counts", async () => {
    const block = generateProtoBlock({
      slot: 1,
      blockRoot: root(2),
      parentRoot: root(1),
      executionPayloadBlockHash: root(12),
      executionPayloadNumber: 1,
      executionPayloadGasLimit: 30_000_000,
      executionStatus: ExecutionStatus.Valid,
      dataAvailabilityStatus: DataAvailabilityStatus.Available,
    });
    protoArray.onBlock(block, 1, null);
    protoArray.onBlock(
      {...block, slot: 2, blockRoot: root(3), parentRoot: root(2), parentBlockHash: root(12)},
      2,
      null
    );
    protoArray.onExecutionPayload(
      root(3),
      2,
      root(13),
      2,
      30_000_000,
      null,
      ExecutionStatus.Syncing,
      DataAvailabilityStatus.Available
    );
    protoArray.notifyPtcMessages(root(3), 2, [0, 2], true, false);
    protoArray.notifyPtcMessages(root(3), 2, [1], false, true);
    protoArray.onBlock(
      {...block, slot: 3, blockRoot: root(4), parentRoot: root(3), parentBlockHash: root(12)},
      3,
      null
    );
    protoArray.onBlock(
      {
        ...block,
        slot: 3,
        blockRoot: root(5),
        parentRoot: root(3),
        parentBlockHash: root(13),
        executionPayloadBlockHash: root(13),
        executionStatus: ExecutionStatus.Syncing,
        executionPayloadNumber: 2,
        executionPayloadGasLimit: 30_000_000,
      },
      3,
      null
    );

    const {data} = await api.getDebugForkChoiceV2();
    assert(!(data instanceof Uint8Array));
    expect(
      data.forkChoiceNodes.map((node) => [
        node.blockRoot,
        node.payloadStatus,
        node.parentRoot,
        node.parentPayloadStatus,
        node.executionBlockHash,
        node.validity,
      ])
    ).toEqual([
      [root(1), "full", ZERO_HASH_HEX, null, ZERO_HASH_HEX, "valid"],
      [root(2), "full", root(1), "full", root(12), "valid"],
      [root(3), "pending", root(2), "full", root(12), "valid"],
      [root(3), "empty", root(3), "pending", root(12), "valid"],
      [root(3), "full", root(3), "pending", root(13), "optimistic"],
      [root(4), "pending", root(3), "empty", root(12), "valid"],
      [root(4), "empty", root(4), "pending", root(12), "valid"],
      [root(5), "pending", root(3), "full", root(13), "optimistic"],
      [root(5), "empty", root(5), "pending", root(13), "optimistic"],
    ]);
    for (const node of data.forkChoiceNodes) {
      expect(node, `${node.blockRoot}/${node.payloadStatus}`).toMatchObject({
        justifiedEpoch: 0,
        finalizedEpoch: 0,
        payloadAttesterCount: node.blockRoot === root(3) ? 3 : 0,
        payloadAvailabilityYesCount: node.blockRoot === root(3) ? 2 : 0,
        payloadDataAvailabilityYesCount: node.blockRoot === root(3) ? 1 : 0,
      });
    }
  });

  it("does not invent the payload status of a pruned parent", async () => {
    protoArray = new ProtoArray({
      pruneThreshold: 0,
      justifiedEpoch: 0,
      justifiedRoot: root(1),
      finalizedEpoch: 0,
      finalizedRoot: root(1),
    });
    protoArray.onBlock(generateProtoBlock({blockRoot: root(1)}), 0, null);
    protoArray.onBlock(
      generateProtoBlock({slot: 1, blockRoot: root(2), parentRoot: root(1), parentBlockHash: ZERO_HASH_HEX}),
      1,
      null
    );
    protoArray.maybePrune(root(2));
    const {data} = await api.getDebugForkChoiceV2();
    assert(!(data instanceof Uint8Array));
    expect(data.forkChoiceNodes).toMatchObject([
      {blockRoot: root(2), payloadStatus: "pending", parentRoot: root(1), parentPayloadStatus: null},
      {blockRoot: root(2), payloadStatus: "empty", parentRoot: root(2), parentPayloadStatus: "pending"},
    ]);
  });
});
