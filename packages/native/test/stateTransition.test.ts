import {ssz} from "@lodestar/types";
import {beforeAll, describe, expect, it} from "vitest";
import bindings from "../src/index.js";
import {createStfState, stfConfig} from "./stfFixture.js";

describe("serialized state transition", () => {
  const config = new bindings.BeaconConfig(stfConfig, new Uint8Array(32));
  let state: InstanceType<typeof bindings.BeaconStateView>;

  beforeAll(() => {
    bindings.pubkeys.ensureCapacity(16);
    state = bindings.BeaconStateView.createFromBytes(ssz.fulu.BeaconState.serialize(createStfState()), config);
  });

  it.each([false, true])("decodes a block with isBlinded=%s before checking its parent", (isBlinded) => {
    const type = isBlinded ? ssz.fulu.SignedBlindedBeaconBlock : ssz.fulu.SignedBeaconBlock;
    const block = type.defaultValue();
    block.message.slot = state.slot + 1;
    block.message.proposerIndex = state.getBeaconProposer(block.message.slot);
    const before = state.hashTreeRoot();

    expect(() =>
      state.stateTransition(type.serialize(block), isBlinded, {
        verifyProposer: false,
        verifySignatures: false,
        verifyStateRoot: false,
      })
    ).toThrow("BlockParentRootMismatch");
    expect(state.hashTreeRoot()).toEqual(before);
  });

  it("exports the fork sequence used by Lodestar", () => {
    expect(state.forkSeq).toBe(6);
    expect(state.forkName).toBe("fulu");
  });

  it("preserves execution header bigint fields in values and SSZ roundtrips", () => {
    const value = createStfState();
    value.latestExecutionPayloadHeader.baseFeePerGas = 1n;
    value.latestExecutionPayloadHeader.blobGasUsed = 2n;
    value.latestExecutionPayloadHeader.excessBlobGas = 3n;
    value.pendingPartialWithdrawals = [{amount: 1n, validatorIndex: 0, withdrawableEpoch: Infinity}];
    const bytes = ssz.fulu.BeaconState.serialize(value);
    const native = bindings.BeaconStateView.createFromBytes(bytes, config);
    expect(native.latestExecutionPayloadHeader).toEqual(value.latestExecutionPayloadHeader);
    const result = native.toValue();
    expect(result.eth1Data.depositCount).toBe(BigInt(value.eth1Data.depositCount));
    // The pinned JS codec still expects a number for this fixture's deposit count.
    result.eth1Data.depositCount = value.eth1Data.depositCount;
    expect(Buffer.compare(ssz.fulu.BeaconState.serialize(result), bytes)).toBe(0);
  }, 30_000);

  it("returns expected withdrawal amounts as bigint", () => {
    const value = createStfState();
    value.validators[0].withdrawalCredentials[0] = 1;
    value.balances[0] = 33_000_000_000;
    const native = bindings.BeaconStateView.createFromBytes(ssz.fulu.BeaconState.serialize(value), config);
    expect(native.getExpectedWithdrawals().expectedWithdrawals[0].amount).toBe(1_000_000_000n);
  });

  it("records explicit and default process block metric sources", () => {
    bindings.metrics.init();
    const value = createStfState();
    value.latestExecutionPayloadHeader.blockHash.fill(1);
    const native = bindings.BeaconStateView.createFromBytes(ssz.fulu.BeaconState.serialize(value), config);
    let advanced: InstanceType<typeof bindings.BeaconStateView> | undefined;
    let explicit: InstanceType<typeof bindings.BeaconStateView> | undefined;
    let regular: InstanceType<typeof bindings.BeaconStateView> | undefined;
    try {
      const slot = native.slot + 1;
      advanced = native.processSlots(slot);
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      block.message.proposerIndex = advanced.getBeaconProposer(slot);
      block.message.parentRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(advanced.latestBlockHeader);
      block.message.body.executionPayload.parentHash.fill(1);
      block.message.body.executionPayload.blockHash.fill(2);
      block.message.body.executionPayload.timestamp = slot * (stfConfig.SECONDS_PER_SLOT ?? 12);
      const blockBytes = ssz.fulu.SignedBeaconBlock.serialize(block);
      const options = {
        dataAvailabilityStatus: "Available" as const,
        executionPayloadStatus: "valid" as const,
        source: "get_historical_state" as const,
        verifyProposer: false,
        verifySignatures: false,
        verifyStateRoot: false,
      };
      explicit = native.stateTransition(blockBytes, false, options);
      regular = native.stateTransition(blockBytes, false, {
        dataAvailabilityStatus: "Available",
        executionPayloadStatus: "valid",
        verifyProposer: false,
        verifySignatures: false,
        verifyStateRoot: false,
      });

      expect(explicit.slot).toBe(slot);
      expect(regular.slot).toBe(slot);
      const metrics = bindings.metrics.scrapeMetrics();
      expect(metrics).toContain('lodestar_stfn_process_block_seconds_count{source="get_historical_state"} 1\n');
      expect(metrics).toContain('lodestar_stfn_process_block_seconds_count{source="block"} 1\n');
    } finally {
      regular?.release();
      explicit?.release();
      advanced?.release();
      native.release();
    }
  });

  describe.each([
    {SECONDS_PER_SLOT: undefined, SLOT_DURATION_MS: 6000, name: "milliseconds only"},
    {SECONDS_PER_SLOT: 12, SLOT_DURATION_MS: 6000, name: "milliseconds with stale legacy seconds"},
    {SECONDS_PER_SLOT: 6, SLOT_DURATION_MS: undefined, name: "legacy seconds only"},
  ])("$name", ({SECONDS_PER_SLOT, SLOT_DURATION_MS}) => {
    it.each([false, true])("transitions isBlinded=%s with a non-default slot duration", (isBlinded) => {
      const chainConfig = {...stfConfig, SECONDS_PER_SLOT, SLOT_DURATION_MS};
      const value = createStfState();
      value.latestExecutionPayloadHeader.blockHash.fill(1);
      const nativeConfig = new bindings.BeaconConfig(chainConfig, new Uint8Array(32));
      const native = bindings.BeaconStateView.createFromBytes(ssz.fulu.BeaconState.serialize(value), nativeConfig);
      const slot = native.slot + 1;
      const advanced = native.processSlots(slot);
      const block = ssz.fulu.SignedBeaconBlock.defaultValue();
      block.message.slot = slot;
      block.message.proposerIndex = advanced.getBeaconProposer(slot);
      block.message.parentRoot = ssz.phase0.BeaconBlockHeader.hashTreeRoot(advanced.latestBlockHeader);
      block.message.body.executionPayload.parentHash.fill(1);
      block.message.body.executionPayload.blockHash.fill(2);
      block.message.body.executionPayload.timestamp = slot * 6;
      const payload = block.message.body.executionPayload;
      const blinded = {
        ...block,
        message: {
          ...block.message,
          body: {
            ...block.message.body,
            executionPayloadHeader: {
              ...payload,
              transactionsRoot: ssz.bellatrix.Transactions.hashTreeRoot(payload.transactions),
              withdrawalsRoot: ssz.capella.Withdrawals.hashTreeRoot(payload.withdrawals),
            },
          },
        },
      };
      const bytes = isBlinded
        ? ssz.fulu.SignedBlindedBeaconBlock.serialize(blinded)
        : ssz.fulu.SignedBeaconBlock.serialize(block);
      const post = native.stateTransition(bytes, isBlinded, {
        dataAvailabilityStatus: "Available",
        executionPayloadStatus: "valid",
        verifyProposer: false,
        verifySignatures: false,
        verifyStateRoot: false,
      });
      expect(post.slot).toBe(slot);
      expect(post.latestExecutionPayloadHeader.timestamp).toBe(slot * 6);
      expect(native.slot).toBe(value.slot);
    });
  });
});
