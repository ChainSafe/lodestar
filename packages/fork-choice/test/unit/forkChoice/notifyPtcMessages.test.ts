import {describe, expect, it, vi} from "vitest";
import {PTC_SIZE} from "@lodestar/params";
import {ForkChoice, ForkChoiceMetrics, ProtoArray, PtcQuorumEvent} from "../../../src/index.js";
import {getBlockRoot} from "../../utils/index.js";
import {
  VALIDATOR_COUNT,
  genesisSlot,
  getPayloadBlockHash,
  gloasConfig,
  headSlot,
  makeStore,
  parentSlot,
  toProtoBlock,
} from "./proposerHeadTestUtils.js";

const threshold = Math.floor(PTC_SIZE / 2);
const majority = Array.from({length: threshold + 1}, (_, i) => i);
const exactlyThreshold = majority.slice(0, -1);
const headRoot = getBlockRoot(headSlot);

function setup(metrics: ForkChoiceMetrics | null = null): {
  forkChoice: ForkChoice;
  notifyPtcQuorum: ReturnType<typeof vi.fn<(data: PtcQuorumEvent) => void>>;
} {
  const genesisRoot = getBlockRoot(genesisSlot);
  const protoArray = ProtoArray.initialize(toProtoBlock(genesisSlot, genesisRoot, false), genesisSlot);
  protoArray.onBlock(toProtoBlock(parentSlot, genesisRoot, true), parentSlot, null);
  protoArray.onBlock(
    toProtoBlock(headSlot, getBlockRoot(parentSlot), true, {parentBlockHash: getPayloadBlockHash(parentSlot)}),
    headSlot,
    null
  );

  const notifyPtcQuorum = vi.fn<(data: PtcQuorumEvent) => void>();
  const forkChoice = new ForkChoice(
    gloasConfig,
    {...makeStore(), notifyPtcQuorum},
    protoArray,
    VALIDATOR_COUNT,
    metrics
  );
  return {forkChoice, notifyPtcQuorum};
}

describe("Forkchoice / notifyPtcMessages", () => {
  it("notifies the store with the new quorum state once a majority is reached", () => {
    const {forkChoice, notifyPtcQuorum} = setup();

    forkChoice.notifyPtcMessages(headRoot, headSlot, exactlyThreshold, true, true);
    expect(notifyPtcQuorum).not.toHaveBeenCalled();

    forkChoice.notifyPtcMessages(headRoot, headSlot, [threshold], true, true);
    expect(notifyPtcQuorum).toHaveBeenCalledTimes(1);
    expect(notifyPtcQuorum).toHaveBeenCalledWith({
      blockRoot: headRoot,
      slot: headSlot,
      payloadPresent: true,
      blobDataAvailable: true,
    });
  });

  it("does not notify again while the quorum state is unchanged", () => {
    const {forkChoice, notifyPtcQuorum} = setup();

    forkChoice.notifyPtcMessages(headRoot, headSlot, majority, true, true);
    forkChoice.notifyPtcMessages(headRoot, headSlot, majority, true, true);
    forkChoice.notifyPtcMessages(headRoot, headSlot, [threshold], true, true);

    expect(notifyPtcQuorum).toHaveBeenCalledTimes(1);
  });

  it("notifies separately as each field reaches its majority", () => {
    const {forkChoice, notifyPtcQuorum} = setup();

    forkChoice.notifyPtcMessages(headRoot, headSlot, exactlyThreshold, true, false);
    forkChoice.notifyPtcMessages(headRoot, headSlot, [threshold], true, true);
    expect(notifyPtcQuorum).toHaveBeenNthCalledWith(1, {
      blockRoot: headRoot,
      slot: headSlot,
      payloadPresent: true,
      blobDataAvailable: null,
    });

    forkChoice.notifyPtcMessages(headRoot, headSlot, exactlyThreshold, true, true);
    expect(notifyPtcQuorum).toHaveBeenNthCalledWith(2, {
      blockRoot: headRoot,
      slot: headSlot,
      payloadPresent: true,
      blobDataAvailable: true,
    });
    expect(notifyPtcQuorum).toHaveBeenCalledTimes(2);
  });

  it("notifies when a flipped vote drops a majority", () => {
    const {forkChoice, notifyPtcQuorum} = setup();

    forkChoice.notifyPtcMessages(headRoot, headSlot, majority, true, true);
    forkChoice.notifyPtcMessages(headRoot, headSlot, [majority[0]], false, true);

    expect(notifyPtcQuorum).toHaveBeenCalledTimes(2);
    expect(notifyPtcQuorum).toHaveBeenLastCalledWith({
      blockRoot: headRoot,
      slot: headSlot,
      payloadPresent: null,
      blobDataAvailable: true,
    });
  });

  it("ignores messages whose slot does not match the block", () => {
    const {forkChoice, notifyPtcQuorum} = setup();

    forkChoice.notifyPtcMessages(headRoot, headSlot + 1, majority, true, true);

    expect(notifyPtcQuorum).not.toHaveBeenCalled();
    expect(forkChoice.getPtcQuorum(headRoot)).toEqual({payloadPresent: null, blobDataAvailable: null});
  });

  it("counts each field reaching a majority in the ptc quorum metric", () => {
    const inc = vi.fn();
    const {forkChoice} = setup({
      forkChoice: {votes: {addCollect: vi.fn()}, ptcQuorum: {inc}},
    } as unknown as ForkChoiceMetrics);

    forkChoice.notifyPtcMessages(headRoot, headSlot, majority, true, false);
    forkChoice.notifyPtcMessages(headRoot, headSlot, [majority[0]], false, false);

    expect(inc.mock.calls).toEqual([
      [{vote: "payloadPresent", result: "true"}],
      [{vote: "blobDataAvailable", result: "false"}],
    ]);
  });

  it("ignores unknown blocks", () => {
    const {forkChoice, notifyPtcQuorum} = setup();

    forkChoice.notifyPtcMessages("0xunknown", headSlot, majority, true, true);

    expect(notifyPtcQuorum).not.toHaveBeenCalled();
    expect(forkChoice.getPtcQuorum("0xunknown")).toBeNull();
  });
});
