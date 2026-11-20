import {Mock, afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {createBeaconConfig} from "@lodestar/config";
import {getConfig} from "@lodestar/config/test-utils";
import {ExecutionStatus, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {pubkeyCache} from "@lodestar/native/pubkeys";
import {
  BUILDER_WITHDRAWAL_PREFIX,
  FAR_FUTURE_EPOCH,
  ForkName,
  MAX_EFFECTIVE_BALANCE,
  MIN_DEPOSIT_AMOUNT,
  SLOTS_PER_EPOCH,
} from "@lodestar/params";
import {
  BeaconStateView,
  IBeaconStateViewGloas,
  createCachedBeaconState,
  isStatePostGloas,
} from "@lodestar/state-transition";
import {gloas, ssz} from "@lodestar/types";
import {fromHex, toRootHex} from "@lodestar/utils";
import {ProposerPreferencesPool} from "../../../src/chain/opPools/proposerPreferencesPool.js";
import {IChainOptions} from "../../../src/chain/options.js";
import {PayloadAttributesAlternates} from "../../../src/chain/payloadAttributesAlternates.js";
import {MockedLogger, getMockedLogger} from "../../mocks/loggerMock.js";
import {MockedBeaconChain, getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {generateState, zeroProtoBlock} from "../../utils/state.js";
import {generateValidators} from "../../utils/validator.js";

const root = (byte: number): string => `0x${byte.toString(16).padStart(2, "0").repeat(32)}`;
const config = createBeaconConfig(getConfig(ForkName.gloas), new Uint8Array(32));
const primaryTopic = routes.events.EventType.payloadAttributes;
const alternateTopic = routes.events.EventType.payloadAttributes;
const validators = generateValidators(SLOTS_PER_EPOCH, {
  activationEpoch: 0,
  effectiveBalance: MAX_EFFECTIVE_BALANCE,
  exitEpoch: FAR_FUTURE_EPOCH,
  withdrawableEpoch: FAR_FUTURE_EPOCH,
});

describe("Gloas payload attribute alternatives", () => {
  let chain: MockedBeaconChain;
  let controller: AbortController;
  let emitter: PayloadAttributesAlternates;
  let listener: Mock;
  let clockSlot: number;
  let head: ProtoBlock;
  let parent: ProtoBlock;
  let headState: IBeaconStateViewGloas;
  let parentState: IBeaconStateViewGloas;
  let preparedHead: IBeaconStateViewGloas;
  let options: IChainOptions;
  let logger: MockedLogger;
  const blocks = new Map<string, ProtoBlock>();
  const states = new Map<string, IBeaconStateViewGloas>();

  function header(slot: number, number: number, parentRoot: string): gloas.BeaconState["latestBlockHeader"] {
    return {
      ...ssz.phase0.BeaconBlockHeader.defaultValue(),
      slot,
      parentRoot: fromHex(parentRoot),
      stateRoot: fromHex(root(number + 100)),
      bodyRoot: ssz.phase0.BeaconBlockBody.hashTreeRoot(ssz.phase0.BeaconBlockBody.defaultValue()),
    };
  }

  function block(slot: number, number: number, parentRoot: string, status = PayloadStatus.EMPTY): ProtoBlock {
    return {
      ...zeroProtoBlock,
      slot,
      blockRoot: toRootHex(ssz.phase0.BeaconBlockHeader.hashTreeRoot(header(slot, number, parentRoot))),
      parentRoot,
      stateRoot: root(number + 100),
      payloadStatus: status,
      parentBlockHash: root(number + 10),
      executionPayloadBlockHash: root(number + (status === PayloadStatus.FULL ? 20 : 10)),
      executionStatus: ExecutionStatus.Valid,
      executionPayloadGasLimit: 30_000_000,
    } as ProtoBlock;
  }

  function state(block: ProtoBlock, number: number, fields: Partial<gloas.BeaconState> = {}): IBeaconStateViewGloas {
    const view = generateState(
      {
        slot: block.slot,
        validators,
        inactivityScores: Array.from({length: validators.length}, () => 0),
        latestBlockHeader: header(block.slot, number, block.parentRoot),
        latestExecutionPayloadBid: {
          ...ssz.gloas.ExecutionPayloadBid.defaultValue(),
          parentBlockHash: fromHex(root(number + 10)),
          blockHash: fromHex(root(number + 20)),
        },
        latestBlockHash: fromHex(root(number + 10)),
        payloadExpectedWithdrawals: [{...ssz.capella.Withdrawal.defaultValue(), index: number, amount: BigInt(number)}],
        ...fields,
      },
      config,
      true
    );
    view.genesisTime = 0;
    view.randaoMixes.set(0, fromHex(root(number + 30)));
    view.commit();
    const result = new BeaconStateView(createCachedBeaconState(view, {config, pubkeyCache}));
    if (!isStatePostGloas(result)) throw Error("Expected Gloas fixture");
    return result;
  }

  function prepare(value: IBeaconStateViewGloas): IBeaconStateViewGloas {
    const result = value.processSlots(clockSlot + 1, {dontTransferCache: true});
    if (!isStatePostGloas(result)) throw Error("Expected prepared Gloas fixture");
    return result;
  }

  function put(value: ProtoBlock): void {
    blocks.set(`${value.blockRoot}:${value.payloadStatus}`, value);
  }

  function setup(slot = 4, parentSlot = slot - 1): void {
    clockSlot = slot;
    vi.setSystemTime(slot * config.SLOT_DURATION_MS);
    parent = block(parentSlot, 2, root(1));
    head = block(slot, 3, parent.blockRoot);
    for (const [number, value] of [
      [2, parent],
      [3, head],
    ] as const) {
      put(value);
      put(block(value.slot, number, value.parentRoot, PayloadStatus.FULL));
    }
    headState = state(head, 3);
    parentState = state(parent, 2);
    states.set(head.stateRoot, headState);
    states.set(parent.stateRoot, parentState);
    preparedHead = prepare(headState);
    chain.forkChoice.getHead.mockImplementation(() => head);
  }

  function request(primaryParent = head, prepared = preparedHead, full = false): void {
    const primary: gloas.SSEPayloadAttributes = {
      ...ssz.gloas.SSEPayloadAttributes.defaultValue(),
      proposerIndex: prepared.getBeaconProposer(clockSlot + 1),
      proposalSlot: clockSlot + 1,
      parentBlockRoot: fromHex(primaryParent.blockRoot),
      parentBlockHash: full
        ? prepared.latestExecutionPayloadBid.blockHash
        : prepared.latestExecutionPayloadBid.parentBlockHash,
      safeBlockHash: fromHex(root(7)),
      finalizedBlockHash: fromHex(root(8)),
    };
    emitter.request({clockSlot, headRoot: head.blockRoot, primaryParent, primary, preparedState: prepared});
  }

  async function flush(): Promise<void> {
    await vi.advanceTimersByTimeAsync(20);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    controller = new AbortController();
    blocks.clear();
    states.clear();
    chain = getMockedBeaconChain({clock: "real", genesisTime: 0, config});
    Object.assign(chain, {proposerPreferencesPool: new ProposerPreferencesPool()});
    options = {
      emitPayloadAttributes: true,
      emitPayloadAttributesAlternates: true,
      payloadAttributesAlternateBuilderIndices: [0],
    } as IChainOptions;
    vi.spyOn(chain, "opts", "get").mockImplementation(() => options);
    chain.forkChoice.getBlockHex.mockImplementation((r, status) => blocks.get(`${r}:${status}`) ?? null);
    chain.forkChoice.getBlockHexDefaultStatus.mockImplementation(
      (r) => blocks.get(`${r}:${PayloadStatus.EMPTY}`) ?? null
    );
    chain.forkChoice.getBlockHexAndBlockHash.mockImplementation(
      (r, hash) => [...blocks.values()].find((b) => b.blockRoot === r && b.executionPayloadBlockHash === hash) ?? null
    );
    chain.forkChoice.getDependentRoot.mockReturnValue(root(9));
    chain.regen.getStateSync.mockImplementation((r) => states.get(r) ?? null);
    chain.regen.getCheckpointStateSync.mockReturnValue(null);
    chain.getParentExecutionRequests.mockImplementation(async () => ssz.gloas.ExecutionRequests.defaultValue());
    listener = vi.fn();
    chain.emitter.on(alternateTopic, listener);
    logger = getMockedLogger();
    emitter = new PayloadAttributesAlternates(chain, config, logger, controller.signal);
    setup();
  });

  afterEach(() => {
    controller.abort();
    vi.useRealTimers();
  });

  it("emits three distinct alternatives with branch-specific FULL/EMPTY withdrawals and requests", async () => {
    const primaryListener = vi.fn();
    chain.emitter.on(primaryTopic, (event) => {
      if (event.context === undefined) primaryListener(event);
    });
    const parentPrepared = prepare(parentState);
    const processParent = vi.spyOn(parentState, "processSlots").mockReturnValue(parentPrepared);
    const applyParent = vi.spyOn(parentPrepared, "withParentPayloadApplied");
    const applyHead = vi.spyOn(preparedHead, "withParentPayloadApplied");
    const headRequests = {
      ...ssz.gloas.ExecutionRequests.defaultValue(),
      builderExits: [{...ssz.gloas.BuilderExitRequest.defaultValue(), sourceAddress: new Uint8Array(20).fill(3)}],
    };
    const parentRequests = {
      ...ssz.gloas.ExecutionRequests.defaultValue(),
      builderExits: [{...ssz.gloas.BuilderExitRequest.defaultValue(), sourceAddress: new Uint8Array(20).fill(2)}],
    };
    chain.getParentExecutionRequests.mockImplementation(async (_slot, r) =>
      r === head.blockRoot ? headRequests : parentRequests
    );
    request();
    expect(listener).not.toHaveBeenCalled();
    await flush();
    expect(logger.debug.mock.calls).toEqual([]);
    const data = listener.mock.calls.map(([event]) => event.data as gloas.SSEPayloadAttributes);
    expect(data.map((d) => [toRootHex(d.parentBlockRoot), toRootHex(d.parentBlockHash)])).toEqual([
      [head.blockRoot, root(23)],
      [parent.blockRoot, root(12)],
      [parent.blockRoot, root(22)],
    ]);
    expect(data.map((d) => d.payloadAttributes.withdrawals)).toEqual([[], parentState.payloadExpectedWithdrawals, []]);
    expect(chain.getParentExecutionRequests.mock.calls).toEqual([
      [head.slot, head.blockRoot],
      [parent.slot, parent.blockRoot],
    ]);
    expect(applyHead).toHaveBeenCalledExactlyOnceWith(headRequests);
    expect(applyParent).toHaveBeenCalledExactlyOnceWith(parentRequests);
    expect(processParent).toHaveBeenCalledExactlyOnceWith(clockSlot + 1, {dontTransferCache: true});
    expect(preparedHead.latestBlockHash).toEqual(fromHex(root(13)));
    expect(parentPrepared.latestBlockHash).toEqual(fromHex(root(12)));
    expect(data.every((d) => d.proposerIndex === preparedHead.getBeaconProposer(clockSlot + 1))).toBe(true);
    expect(data.every((d) => d.payloadAttributes.slotNumber === clockSlot + 1)).toBe(true);
    expect(primaryListener).not.toHaveBeenCalled();
    expect(listener.mock.calls.every(([event]) => event.context.role === "alternate")).toBe(true);
    expect(chain.executionEngine.notifyForkchoiceUpdate).not.toHaveBeenCalled();
    expect(chain.regen.getBlockSlotState).not.toHaveBeenCalled();
  });

  it("emits current head variants when the authoritative primary is the direct parent", async () => {
    request(parent, prepare(parentState), true);
    await flush();
    expect(
      listener.mock.calls.map(([e]) => [toRootHex(e.data.parentBlockRoot), toRootHex(e.data.parentBlockHash)])
    ).toEqual([
      [head.blockRoot, root(13)],
      [head.blockRoot, root(23)],
      [parent.blockRoot, root(12)],
    ]);
  });

  it.each(["primary", "post-state", "checkpoint"] as const)(
    "rejects a %s state from another beacon parent even when the EL parent hash matches",
    async (source) => {
      if (source === "checkpoint") setup(SLOTS_PER_EPOCH - 1);
      const wrongState = state(head, 3, {
        latestExecutionPayloadBid: parentState.latestExecutionPayloadBid,
        latestBlockHash: parentState.latestBlockHash,
      });
      const wrongPrepared = prepare(wrongState);
      expect(toRootHex(wrongPrepared.getBlockRootAtSlot(clockSlot))).toBe(head.blockRoot);
      expect(wrongPrepared.latestExecutionPayloadBid.parentBlockHash).toEqual(
        parentState.latestExecutionPayloadBid.parentBlockHash
      );
      if (source === "primary") {
        request(parent, wrongPrepared, true);
      } else {
        if (source === "post-state") states.set(parent.stateRoot, wrongState);
        else chain.regen.getCheckpointStateSync.mockReturnValue(wrongPrepared);
        request();
      }
      await flush();
      expect(listener.mock.calls.some(([event]) => toRootHex(event.data.parentBlockRoot) === parent.blockRoot)).toBe(
        false
      );
      expect(chain.getParentExecutionRequests.mock.calls.some(([, blockRoot]) => blockRoot === parent.blockRoot)).toBe(
        false
      );
    }
  );

  it("rejects FULL when its variant refers to a different state", async () => {
    put({...block(parent.slot, 2, parent.parentRoot, PayloadStatus.FULL), stateRoot: root(255)});
    request();
    await flush();
    expect(listener.mock.calls.map(([event]) => toRootHex(event.data.parentBlockHash))).toEqual([root(23), root(12)]);
  });

  it("does not emit FULL if its request source violates the non-null contract", async () => {
    chain.getParentExecutionRequests.mockResolvedValue(null as unknown as gloas.ExecutionRequests);
    request();
    await flush();
    expect(listener.mock.calls.map(([event]) => toRootHex(event.data.parentBlockHash))).toEqual([root(12)]);
  });

  it("binds eligibility to the prepared branch including FULL deposits and pending liabilities", async () => {
    setup(2 * SLOTS_PER_EPOCH);
    const builder = {
      ...ssz.gloas.Builder.defaultValue(),
      pubkey: new Uint8Array(48).fill(11),
      version: 1,
      balance: MIN_DEPOSIT_AMOUNT + 5000,
      depositEpoch: 0,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
    };
    const payments = ssz.gloas.BuilderPendingPayments.defaultValue();
    payments[SLOTS_PER_EPOCH + (head.slot % SLOTS_PER_EPOCH)].withdrawal.amount = 700;
    headState = state(head, 3, {
      builders: [builder],
      finalizedCheckpoint: {...ssz.phase0.Checkpoint.defaultValue(), epoch: 1},
      builderPendingPayments: payments,
      builderPendingWithdrawals: [{...ssz.gloas.BuilderPendingWithdrawal.defaultValue(), amount: 300}],
    });
    preparedHead = prepare(headState);
    const applyHead = vi.spyOn(preparedHead, "withParentPayloadApplied");
    parentState = state(parent, 2, {
      builders: [{...builder, pubkey: new Uint8Array(48).fill(12), balance: MIN_DEPOSIT_AMOUNT + 3000}],
      finalizedCheckpoint: {...ssz.phase0.Checkpoint.defaultValue(), epoch: 1},
    });
    const checkpoint = prepare(parentState);
    chain.regen.getCheckpointStateSync.mockReturnValue(checkpoint);
    const credentials = new Uint8Array(32);
    credentials[0] = BUILDER_WITHDRAWAL_PREFIX;
    const requests = ssz.gloas.ExecutionRequests.defaultValue();
    requests.builderDeposits.push({
      ...ssz.gloas.BuilderDepositRequest.defaultValue(),
      pubkey: builder.pubkey,
      withdrawalCredentials: credentials,
      amount: 123,
    });
    chain.getParentExecutionRequests.mockImplementation(async (_slot, r) =>
      r === head.blockRoot ? requests : ssz.gloas.ExecutionRequests.defaultValue()
    );
    request();
    await flush();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener.mock.calls.map(([e]) => e.context.dependentRoot)).toEqual(
      Array.from({length: 3}, () => fromHex(root(9)))
    );
    const entries = listener.mock.calls.map(([e]) => e.context.builders[0]);
    expect(entries.map((b) => b.availableGwei)).toEqual([4123, 3000, 3000]);
    const applied = applyHead.mock.results[0].value;
    expect(applied.canBuilderCoverBid(0, 4123)).toBe(true);
    expect(applied.canBuilderCoverBid(0, 4124)).toBe(false);
    expect(entries.map((b) => b.pubkey)).toEqual([
      builder.pubkey,
      new Uint8Array(48).fill(12),
      new Uint8Array(48).fill(12),
    ]);
    expect(entries.every((b) => b.active && b.index === 0 && b.version === 1)).toBe(true);
    expect(preparedHead.getBuilder(0).balance).toBe(MIN_DEPOSIT_AMOUNT + 5000);
    expect(preparedHead.builderPendingPayments[SLOTS_PER_EPOCH].withdrawal.amount).toBe(700);
    expect(preparedHead.builderPendingWithdrawals[0].amount).toBe(300);
  });

  it("reports a FULL-parent exit as inactive while the EMPTY parent remains active", async () => {
    setup(2 * SLOTS_PER_EPOCH + 2);
    const builder = {
      ...ssz.gloas.Builder.defaultValue(),
      pubkey: new Uint8Array(48).fill(11),
      balance: MIN_DEPOSIT_AMOUNT + 5000,
      depositEpoch: 0,
      withdrawableEpoch: FAR_FUTURE_EPOCH,
    };
    parentState = state(parent, 2, {
      builders: [builder],
      finalizedCheckpoint: {...ssz.phase0.Checkpoint.defaultValue(), epoch: 1},
    });
    states.set(parent.stateRoot, parentState);
    const requests = ssz.gloas.ExecutionRequests.defaultValue();
    requests.builderExits.push({pubkey: builder.pubkey, sourceAddress: builder.executionAddress});
    chain.getParentExecutionRequests.mockImplementation(async (_slot, r) =>
      r === parent.blockRoot ? requests : ssz.gloas.ExecutionRequests.defaultValue()
    );
    request();
    await flush();
    expect(
      listener.mock.calls.map(([e]) => e.context.builders.map((b: routes.events.AlternateBuilder) => b.active))
    ).toEqual([[], [true], [false]]);
    expect(parentState.getBuilder(0).withdrawableEpoch).toBe(FAR_FUTURE_EPOCH);
  });

  it("omits unsafe collateral instead of rounding and reports underfunded builders with zero", async () => {
    const applied = preparedHead.withParentPayloadApplied(ssz.gloas.ExecutionRequests.defaultValue());
    vi.spyOn(preparedHead, "withParentPayloadApplied").mockReturnValue(applied);
    vi.spyOn(applied, "getBuildersLength").mockReturnValue(1);
    const entry = {...ssz.gloas.Builder.defaultValue(), balance: Number.MAX_SAFE_INTEGER + 1};
    vi.spyOn(applied, "getBuilder").mockImplementation(() => entry);
    request();
    await flush();
    expect(listener.mock.calls[0][0].context.builders).toEqual([]);
    setup(clockSlot + 1);
    const next = preparedHead.withParentPayloadApplied(ssz.gloas.ExecutionRequests.defaultValue());
    vi.spyOn(preparedHead, "withParentPayloadApplied").mockReturnValue(next);
    vi.spyOn(next, "getBuildersLength").mockReturnValue(1);
    vi.spyOn(next, "getBuilder").mockReturnValue({...entry, balance: MIN_DEPOSIT_AMOUNT - 1});
    request();
    await flush();
    expect(listener.mock.calls[3][0].context.builders[0].availableGwei).toBe(0);
  });

  it("does no branch work without configured identities and rejects unbounded or ambiguous lists", async () => {
    options.payloadAttributesAlternateBuilderIndices = [];
    emitter = new PayloadAttributesAlternates(chain, config, logger, controller.signal);
    request();
    await flush();
    expect(listener).not.toHaveBeenCalled();
    expect(chain.regen.getStateSync).not.toHaveBeenCalled();
    for (const indices of [[0, 0], [-1], [1.1], [Number.MAX_SAFE_INTEGER + 1], Array.from({length: 17}, (_, i) => i)]) {
      options.payloadAttributesAlternateBuilderIndices = indices;
      expect(
        () => new PayloadAttributesAlternates(chain, config, logger, controller.signal),
        JSON.stringify(indices)
      ).toThrow("INVALID_PAYLOAD_ATTRIBUTES_ALTERNATE_BUILDER_INDICES");
    }
  });

  it("handles a direct parent separated by skipped slots", async () => {
    setup(8, 3);
    request();
    await flush();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(chain.getParentExecutionRequests).toHaveBeenCalledWith(3, parent.blockRoot);
  });

  it("does no work with flag off, primary disabled, no subscriber or a non-Gloas fork", async () => {
    options.emitPayloadAttributesAlternates = false;
    request();
    options.emitPayloadAttributesAlternates = true;
    options.emitPayloadAttributes = false;
    request();
    options.emitPayloadAttributes = true;
    options.fastConfirmation = true;
    request();
    options.fastConfirmation = false;
    chain.emitter.off(alternateTopic, listener);
    request();
    chain.emitter.on(alternateTopic, listener);
    const fork = vi.spyOn(config, "getForkName").mockReturnValueOnce(ForkName.fulu);
    request();
    fork.mockReturnValueOnce(ForkName.heze);
    request();
    await flush();
    expect(listener).not.toHaveBeenCalled();
    expect(chain.regen.getStateSync).not.toHaveBeenCalled();
  });

  it("omits FULL when unavailable and cold parent state without regeneration", async () => {
    blocks.delete(`${head.blockRoot}:${PayloadStatus.FULL}`);
    states.delete(parent.stateRoot);
    request();
    await flush();
    expect(listener).not.toHaveBeenCalled();
    expect(chain.getParentExecutionRequests).not.toHaveBeenCalled();
    expect(chain.regen.getBlockSlotState).not.toHaveBeenCalled();
  });

  it("omits execution-invalid variants before preparing them", async () => {
    const full = block(head.slot, 3, head.parentRoot, PayloadStatus.FULL);
    if (full.executionStatus === ExecutionStatus.PreMerge) throw Error("Expected post-merge fixture");
    put({...full, executionStatus: ExecutionStatus.Invalid});
    states.delete(parent.stateRoot);
    request();
    await flush();
    expect(listener).not.toHaveBeenCalled();
    expect(chain.getParentExecutionRequests).not.toHaveBeenCalled();
  });

  it("skips parent branch with a different dependent root", async () => {
    chain.forkChoice.getDependentRoot.mockImplementation((b) =>
      b.blockRoot === parent.blockRoot ? root(10) : root(9)
    );
    request();
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(toRootHex(listener.mock.calls[0][0].data.parentBlockRoot)).toBe(head.blockRoot);
  });

  it("skips parent branch with a different proposer", async () => {
    const prepared = prepare(parentState);
    vi.spyOn(prepared, "getBeaconProposer").mockReturnValue(15);
    vi.spyOn(parentState, "processSlots").mockReturnValue(prepared);
    request();
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("deduplicates coalesced and repeated primary triggers without retrying failed contexts", async () => {
    chain.getParentExecutionRequests.mockRejectedValue(Error("fixture unavailable"));
    request();
    request();
    request();
    await flush();
    request();
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(chain.getParentExecutionRequests).toHaveBeenCalledTimes(2);
  });

  it("drops work when head changes while fetching FULL requests", async () => {
    let release: ((requests: gloas.ExecutionRequests) => void) | undefined;
    chain.getParentExecutionRequests.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    request();
    await flush();
    expect(release).toBeDefined();
    head = {...head, blockRoot: root(40)};
    release?.(ssz.gloas.ExecutionRequests.defaultValue());
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });

  it("preserves an unreached variant after a primary change without refunding state preparation", async () => {
    const preparedParent = prepare(parentState);
    vi.spyOn(parentState, "processSlots").mockImplementationOnce(() => {
      request(head, preparedHead, true);
      return preparedParent;
    });
    request();
    await flush();
    expect(listener.mock.calls.map(([event]) => toRootHex(event.data.parentBlockHash))).toEqual([
      root(23),
      root(13),
      root(22),
    ]);
    expect(chain.getParentExecutionRequests).toHaveBeenCalledTimes(2);
    expect(parentState.processSlots).toHaveBeenCalledTimes(2);
    request();
    await flush();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(parentState.processSlots).toHaveBeenCalledTimes(2);
  });

  it("drops a FULL variant removed while its execution requests were loading", async () => {
    let release: ((requests: gloas.ExecutionRequests) => void) | undefined;
    chain.getParentExecutionRequests.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    request();
    await flush();
    blocks.delete(`${head.blockRoot}:${PayloadStatus.FULL}`);
    release?.(ssz.gloas.ExecutionRequests.defaultValue());
    await flush();
    expect(listener.mock.calls.map(([event]) => toRootHex(event.data.parentBlockRoot))).toEqual([
      parent.blockRoot,
      parent.blockRoot,
    ]);
  });

  it("keeps a four-attempt slot budget across head changes and only resets for a later slot", async () => {
    request();
    await flush();
    expect(listener).toHaveBeenCalledTimes(3);
    const firstParent = parent;
    head = block(clockSlot, 4, firstParent.blockRoot);
    put(head);
    put(block(clockSlot, 4, firstParent.blockRoot, PayloadStatus.FULL));
    preparedHead = prepare(state(head, 4));
    request();
    await flush();
    expect(listener).toHaveBeenCalledTimes(4);
    head = block(clockSlot, 5, firstParent.blockRoot);
    put(head);
    put(block(clockSlot, 5, firstParent.blockRoot, PayloadStatus.FULL));
    preparedHead = prepare(state(head, 5));
    request();
    await flush();
    expect(listener).toHaveBeenCalledTimes(4);
    setup(clockSlot + 1);
    request();
    await flush();
    expect(listener).toHaveBeenCalledTimes(7);
  });

  it("drops work when slot advances or aborts during FULL lookup", async () => {
    let release: ((requests: gloas.ExecutionRequests) => void) | undefined;
    chain.getParentExecutionRequests.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = resolve;
        })
    );
    request();
    await flush();
    vi.setSystemTime((clockSlot + 1) * config.SLOT_DURATION_MS);
    controller.abort();
    release?.(ssz.gloas.ExecutionRequests.defaultValue());
    await flush();
    expect(listener).not.toHaveBeenCalled();
  });

  it("skips an epoch-crossing parent without a cached checkpoint and preserves copied prevRandao", async () => {
    setup(SLOTS_PER_EPOCH - 1);
    request();
    await flush();
    expect(listener).toHaveBeenCalledTimes(1);
    expect(chain.regen.getCheckpointStateSync).toHaveBeenCalledExactlyOnceWith({epoch: 1, rootHex: parent.blockRoot});
    expect(listener.mock.calls[0][0].data.payloadAttributes.prevRandao).toEqual(headState.getRandaoMix(0));
    expect(listener.mock.calls[0][0].data.payloadAttributes.prevRandao).toEqual(fromHex(root(33)));
    expect(chain.regen.getStateSync).not.toHaveBeenCalled();
  });

  it("uses only the parent's exact cached checkpoint at an epoch boundary", async () => {
    setup(SLOTS_PER_EPOCH - 1);
    const checkpoint = prepare(parentState);
    chain.regen.getCheckpointStateSync.mockImplementation((cp) =>
      cp.rootHex === parent.blockRoot && cp.epoch === 1 ? checkpoint : null
    );
    const process = vi.spyOn(checkpoint, "processSlots");
    request();
    await flush();
    expect(listener).toHaveBeenCalledTimes(3);
    expect(process).not.toHaveBeenCalled();
    expect(listener.mock.calls[2][0].data.payloadAttributes.prevRandao).toEqual(parentState.getRandaoMix(0));
  });
});
