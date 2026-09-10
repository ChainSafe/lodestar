import {describe, expect, it, vi} from "vitest";
import {ssz} from "@lodestar/types";
import {toHex} from "@lodestar/utils";
import type {Simulation} from "../../utils/crucible/simulation.js";
import {waitForHead} from "../../utils/crucible/utils/network.js";
import {assertUnknownBlockSync} from "../../utils/crucible/utils/syncing.js";

vi.mock("../../utils/crucible/utils/network.js", () => ({
  connectNewNode: vi.fn(),
  connectNewCLNode: vi.fn(),
  connectNewELNode: vi.fn(),
  waitForHead: vi.fn(),
  waitForSlot: vi.fn(),
}));

vi.mock("@lodestar/utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@lodestar/utils")>()),
  sleep: vi.fn(),
}));

describe("assertUnknownBlockSync", () => {
  function setup() {
    const block = ssz.electra.SignedBeaconBlock.defaultValue();
    block.message.slot = 34;
    const root = ssz.electra.BeaconBlock.hashTreeRoot(block.message);
    const publishBlockV2 = vi.fn().mockResolvedValue({assertOk: vi.fn()});
    const getBlockHeader = vi.fn().mockResolvedValue({value: () => ({root})});
    const node = {
      beacon: {
        api: {beacon: {publishBlockV2, getBlockHeader}},
        job: {start: vi.fn(), stop: vi.fn()},
      },
      execution: {job: {start: vi.fn(), stop: vi.fn()}},
    };
    const record = vi.fn();
    const env = {
      nodes: [
        {
          beacon: {
            api: {
              beacon: {
                getBlockV2: vi.fn().mockResolvedValue({value: () => block}),
                getBlobSidecars: vi.fn().mockResolvedValue({value: () => []}),
              },
            },
          },
        },
      ],
      createNodePair: vi.fn().mockResolvedValue(node),
      clock: {currentSlot: 38},
      forkConfig: {getForkTypes: () => ssz.electra},
      tracker: {record},
    } as unknown as Simulation;

    return {env, node, root, record, publishBlockV2, getBlockHeader};
  }

  it("accepts successful publication when the exact target block is present", async () => {
    const {env, node, root, record, getBlockHeader} = setup();

    await assertUnknownBlockSync(env);

    expect(record).not.toHaveBeenCalled();
    expect(waitForHead).toHaveBeenCalledWith(env, node, {head: toHex(root), slot: 34});
    expect(getBlockHeader).toHaveBeenCalledExactlyOnceWith({blockId: toHex(root)});
    expect(vi.mocked(waitForHead).mock.invocationCallOrder[0]).toBeLessThan(getBlockHeader.mock.invocationCallOrder[0]);
    expect(node.beacon.job.stop).toHaveBeenCalledOnce();
    expect(node.execution.job.stop).toHaveBeenCalledOnce();
  });

  it.each(["BLOCK_ERROR_PARENT_BLOCK_UNKNOWN", "BLOCK_ERROR_ALREADY_KNOWN"])(
    "accepts %s only when the target block is eventually present",
    async (code) => {
      const {env, root, record, publishBlockV2, getBlockHeader} = setup();
      publishBlockV2.mockResolvedValue({
        assertOk: () => {
          throw new Error(code);
        },
      });

      await assertUnknownBlockSync(env);

      expect(record).not.toHaveBeenCalled();
      expect(getBlockHeader).toHaveBeenCalledExactlyOnceWith({blockId: toHex(root)});
    }
  );

  it("still records unexpected publication errors", async () => {
    const {env, record, publishBlockV2} = setup();
    publishBlockV2.mockRejectedValue(new Error("BLOCK_ERROR_INVALID_SIGNATURE"));

    await assertUnknownBlockSync(env);

    expect(record).toHaveBeenCalledExactlyOnceWith({
      message: expect.stringContaining("BLOCK_ERROR_INVALID_SIGNATURE"),
      slot: 38,
      assertionId: "unknownBlockParent",
    });
  });

  it.each([undefined, "BLOCK_ERROR_PARENT_BLOCK_UNKNOWN", "BLOCK_ERROR_ALREADY_KNOWN"])(
    "records a missing target block after publication outcome %s",
    async (code) => {
      const {env, node, record, publishBlockV2, getBlockHeader} = setup();
      if (code) publishBlockV2.mockRejectedValue(new Error(code));
      getBlockHeader.mockResolvedValue({
        value: () => {
          throw new Error("Block not found");
        },
      });

      await assertUnknownBlockSync(env);

      expect(record).toHaveBeenCalledExactlyOnceWith({
        message: expect.stringContaining("Block not found"),
        slot: 38,
        assertionId: "unknownBlockParent",
      });
      expect(node.beacon.job.stop).toHaveBeenCalledOnce();
      expect(node.execution.job.stop).toHaveBeenCalledOnce();
    }
  );

  it("does not accept a later head as evidence of the target block", async () => {
    const {env, record, getBlockHeader} = setup();
    getBlockHeader.mockResolvedValue({value: () => ({root: new Uint8Array(32).fill(1)})});

    await assertUnknownBlockSync(env);

    expect(record).toHaveBeenCalledExactlyOnceWith({
      message: expect.stringContaining("does not match"),
      slot: 38,
      assertionId: "unknownBlockParent",
    });
  });

  it.each(["Request timed out", "BLOCK_ERROR_ALREADY_KNOWN"])(
    "records block lookup failure %s regardless of the publication outcome",
    async (message) => {
      const {env, record, getBlockHeader} = setup();
      getBlockHeader.mockRejectedValue(new Error(message));

      await assertUnknownBlockSync(env);

      expect(record).toHaveBeenCalledExactlyOnceWith({
        message: expect.stringContaining(`: ${message}`),
        slot: 38,
        assertionId: "unknownBlockParent",
      });
    }
  );
});
