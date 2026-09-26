import {subscribe, unsubscribe} from "node:diagnostics_channel";
import http from "node:http";
import {AddressInfo} from "node:net";
import {afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {BlockInputColumns, BlockInputSource} from "../../../../src/chain/blocks/blockInput/index.js";
import {
  DISPATCH_GATE_DEADLINE_MS,
  DispatchArm,
  DispatchGateSwitch,
  firstArmOfPair,
} from "../../../../src/chain/blocks/dispatchGate.js";
import {verifyBlocksInEpoch} from "../../../../src/chain/blocks/verifyBlock.js";
import {verifyBlocksDataAvailability} from "../../../../src/chain/blocks/verifyBlocksDataAvailability.js";
import {verifyBlocksSignatures} from "../../../../src/chain/blocks/verifyBlocksSignatures.js";
import {verifyBlocksStateTransitionOnly} from "../../../../src/chain/blocks/verifyBlocksStateTransitionOnly.js";
import {BlockTrace} from "../../../../src/chain/blockTrace/index.js";
import {BeaconChain} from "../../../../src/chain/chain.js";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {GetBlobsTracker} from "../../../../src/chain/GetBlobsTracker.js";
import {SeenBlockProposers} from "../../../../src/chain/seenCache/seenBlockProposers.js";
import {ExecutionEngineHttp} from "../../../../src/execution/engine/http.js";
import {HttpRequestTimes, JsonRpcHttpClient} from "../../../../src/execution/engine/jsonRpcHttpClient.js";
import {isQueueErrorAborted} from "../../../../src/util/queue/index.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";
import {generateProtoBlock} from "../../../utils/typeGenerator.js";

vi.mock("../../../../src/chain/blocks/verifyBlocksStateTransitionOnly.js");
vi.mock("../../../../src/chain/blocks/verifyBlocksSignatures.js");
vi.mock("../../../../src/chain/blocks/verifyBlocksDataAvailability.js");

const config = createChainForkConfig({
  ...defaultChainConfig,
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  CAPELLA_FORK_EPOCH: 0,
  DENEB_FORK_EPOCH: 0,
  ELECTRA_FORK_EPOCH: 0,
  FULU_FORK_EPOCH: 0,
});
const slot = 100;
const epoch = Math.floor(slot / SLOTS_PER_EPOCH);
/** Synchronous state transition time the mock spends, as the real one blocks the event loop */
const STF_MS = 30;

describe("chain / blocks / verifyBlocksInEpoch / dispatch gate over loopback", () => {
  let server: http.Server;
  let url: string;
  let forkchoiceDelayMs = 0;
  let stfStart = NaN;
  const aborts: AbortController[] = [];

  beforeAll(async () => {
    // A JSON-RPC engine answering newPayload VALID, getBlobs with null and forkchoiceUpdated after a delay
    server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        const {id, method} = JSON.parse(body) as {id: number; method: string};
        const reply = (result: unknown, delayMs: number): void => {
          setTimeout(() => res.end(JSON.stringify({jsonrpc: "2.0", id, result})), delayMs);
        };
        if (method.startsWith("engine_newPayload")) {
          reply({status: "VALID", latestValidHash: `0x${"00".repeat(32)}`, validationError: null}, 5);
        } else if (method === "engine_getBlobsV2") {
          reply(null, 5);
        } else if (method.startsWith("engine_forkchoiceUpdated")) {
          reply(
            {payloadStatus: {status: "VALID", latestValidHash: null, validationError: null}, payloadId: null},
            forkchoiceDelayMs
          );
        } else {
          res.end(JSON.stringify({jsonrpc: "2.0", id, error: {code: -32601, message: "Method not found"}}));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterAll(async () => {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  afterEach(() => {
    for (const abort of aborts.splice(0)) abort.abort();
  });

  beforeEach(() => {
    forkchoiceDelayMs = 0;
    stfStart = NaN;
    vi.mocked(verifyBlocksStateTransitionOnly).mockImplementation(async (preState) => {
      stfStart = performance.now();
      while (performance.now() - stfStart < STF_MS);
      return {postStates: [preState], proposerBalanceDeltas: [0], verifyStateTime: Date.now()};
    });
    vi.mocked(verifyBlocksSignatures).mockResolvedValue({verifySignaturesTime: Date.now()});
    vi.mocked(verifyBlocksDataAvailability).mockResolvedValue({
      dataAvailabilityStatuses: [DataAvailabilityStatus.Available],
      availableTime: Date.now(),
    });
  });

  /**
   * Verifies a live Fulu gossip block with root `root` in `arm`, with a blob unless `noBlobs`, returning its trace root
   * and the verification's error; `whilePrestate` runs during its prestate regeneration
   */
  async function verify(
    arm: DispatchArm,
    opts: {
      getBlobs: boolean;
      noBlobs?: boolean;
      root?: string;
      proposerIndex?: number;
      beforeBlock?: (engine: ExecutionEngineHttp) => void;
      whilePrestate?: (dispatchGate: DispatchGateSwitch) => void;
    },
    shared = setupChain(arm)
  ) {
    const {chain, blockTrace, getBlobsTracker, executionEngine, dispatchGate} = shared;
    const root = opts.root ?? "0xaa";
    const proposerIndex = opts.proposerIndex ?? 0;
    const {whilePrestate} = opts;
    shared.whilePrestate = whilePrestate ? () => whilePrestate(dispatchGate) : null;
    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.proposerIndex = proposerIndex;
    block.message.body.blobKzgCommitments = opts.noBlobs ? [] : [new Uint8Array(48)];
    const blockInput = BlockInputColumns.createFromBlock({
      forkName: ForkName.fulu,
      block,
      blockRootHex: root,
      source: BlockInputSource.gossip,
      seenTimestampSec: Date.now() / 1000,
      daOutOfRange: false,
      sampledColumns: [0],
      custodyColumns: [0],
    });

    opts.beforeBlock?.(executionEngine);
    // As the gossip block handler does, getBlobs is triggered before the block is processed
    if (opts.getBlobs) getBlobsTracker.triggerGetBlobs(blockInput);
    const attempt = blockTrace.startAttempt([blockInput], performance.now());
    const error = await verifyBlocksInEpoch
      .call(
        chain,
        generateProtoBlock({slot: slot - 1}),
        [blockInput],
        null,
        {seenTimestampSec: Date.now() / 1000},
        attempt
      )
      .then(
        () => null,
        (e: unknown) => e
      );
    const {milestoneNames, slots} = blockTrace.getSnapshot();
    const traced = slots[0].roots.find((r) => r.root === root);
    if (traced === undefined) throw Error(`Untraced root ${root}`);
    const milestones = Object.fromEntries(milestoneNames.map((name, i) => [name, traced.milestones[i]]));
    return {root: traced, milestones, error, dispatchGate};
  }

  /** A chain whose treatment arm covers the block's epoch unless `arm` is control, with an HTTP engine on the server */
  function setupChain(arm: DispatchArm) {
    const logger = getMockedLogger();
    const clock = new ClockStopped(slot);
    const abort = new AbortController();
    aborts.push(abort);
    const executionEngine = new ExecutionEngineHttp(
      new JsonRpcHttpClient([url], {signal: abort.signal}),
      {signal: abort.signal, logger, metrics: null},
      {urls: [url], retries: 0, retryDelay: 0}
    );
    const blockTrace = new BlockTrace(config, clock, null);
    let seed = 0;
    while (firstArmOfPair(seed, 0) !== DispatchArm.treatment) seed++;
    const dispatchGate = new DispatchGateSwitch(
      arm === DispatchArm.treatment ? {seed, startEpoch: epoch, pairs: 1} : null,
      clock,
      logger,
      null,
      null
    );
    const getBlobsTracker = new GetBlobsTracker({
      logger,
      executionEngine,
      emitter: new ChainEventEmitter(),
      metrics: null,
      config,
      blockTrace,
    });
    const preState = {
      slot,
      forkName: ForkName.fulu,
      isExecutionStateType: true,
      isExecutionEnabled: () => true,
      isStateValidatorsNodesPopulated: () => true,
    } as unknown as IBeaconStateView;
    const shared = {
      chain: undefined as unknown as BeaconChain,
      blockTrace,
      getBlobsTracker,
      executionEngine,
      dispatchGate,
      abort,
      /** Runs during the next prestate regeneration, which then yields to the event loop first */
      whilePrestate: null as (() => void) | null,
    };
    shared.chain = {
      config,
      logger,
      metrics: null,
      validatorMonitor: null,
      executionEngine,
      dispatchGate,
      getBlobsTracker,
      seenBlockProposers: new SeenBlockProposers(),
      regen: {
        getPreState: async () => {
          const whilePrestate = shared.whilePrestate;
          shared.whilePrestate = null;
          if (whilePrestate !== null) {
            await new Promise((resolve) => setTimeout(resolve, 1));
            whilePrestate();
          }
          return preState;
        },
      },
      shufflingCache: {processState: () => {}},
    } as unknown as BeaconChain;
    return shared;
  }

  it("hands newPayload and getBlobs to the connection before the state transition starts when the gate succeeds", async () => {
    const {root, milestones, error} = await verify(DispatchArm.treatment, {getBlobs: true});
    expect(error).toBeNull();
    expect(root.arm).toBe(DispatchArm.treatment);
    expect(root.dispatchGate).toMatchObject({outcome: "both_sent", getBlobs: "pending", getBlobsTraced: true});
    const {execution_first_sent, getblobs_first_sent, state_transition_start} = milestones;
    expect(execution_first_sent).not.toBeNull();
    expect(getblobs_first_sent).not.toBeNull();
    expect(execution_first_sent).toBeLessThan(state_transition_start as number);
    expect(getblobs_first_sent).toBeLessThan(state_transition_start as number);
    expect(root.dispatchGate?.getBlobsFirstSentMs).toBe(getblobs_first_sent);
    expect(milestones.execution_dispatch).toBe(execution_first_sent);
    expect(root.waits.dispatchGate?.endMs).toBeLessThanOrEqual(state_transition_start as number);
    expect(Number.isNaN(stfStart)).toBe(false);
  });

  it("ends the wait when the triggered getBlobs call skips its request", async () => {
    const {root, milestones} = await verify(DispatchArm.treatment, {getBlobs: true, noBlobs: true});
    expect(root.dispatchGate).toMatchObject({outcome: "new_payload_only", getBlobs: "pending"});
    expect(milestones.getblobs_request).toBeNull();
    expect(milestones.execution_dispatch).toBeLessThan(milestones.state_transition_start as number);
  });

  it("ends the wait at once when newPayload fails before reaching HTTP, and still surfaces the failure", async () => {
    const shared = setupChain(DispatchArm.treatment);
    // The engine queue refuses newPayload before any request
    shared.abort.abort();
    const {root, milestones, error} = await verify(DispatchArm.treatment, {getBlobs: false}, shared);
    expect(isQueueErrorAborted(error)).toBe(true);
    expect(root.dispatchGate).toMatchObject({outcome: "skipped", getBlobs: "none"});
    expect(root.dispatchGate?.settledMs).toBeLessThan(DISPATCH_GATE_DEADLINE_MS);
    expect(milestones.execution_dispatch).toBeNull();
    expect(milestones.state_transition_start).not.toBeNull();
  });

  it("keeps an attempt's arm when control is forced during its prestate regeneration, and forces the next", async () => {
    const shared = setupChain(DispatchArm.treatment);
    const first = await verify(
      DispatchArm.treatment,
      {getBlobs: false, whilePrestate: (gate) => gate.setForceControl(true)},
      shared
    );
    expect(first.error).toBeNull();
    expect(first.root.arm).toBe(DispatchArm.treatment);
    expect(first.root.dispatchGate).toMatchObject({outcome: "new_payload_only"});
    const second = await verify(DispatchArm.treatment, {getBlobs: false, root: "0xbb", proposerIndex: 1}, shared);
    expect(second.error).toBeNull();
    expect(second.root.arm).toBe(DispatchArm.control);
    expect(second.root.dispatchGate).toBeNull();
    expect(second.milestones.execution_dispatch).toBeGreaterThan(second.milestones.state_transition_start as number);
  });

  it("sends newPayload only after the synchronous state transition in the control arm", async () => {
    const {root, milestones} = await verify(DispatchArm.control, {getBlobs: false});
    expect(root.arm).toBe(DispatchArm.control);
    expect(root.dispatchGate).toBeNull();
    expect(milestones.execution_dispatch).toBeGreaterThanOrEqual(
      (milestones.state_transition_start as number) + STF_MS
    );
  });

  it("counts work after the settlement until the verification resumes in the gate's delay", async () => {
    // Joins this process's HTTP diagnostics channels before the stall below subscribes behind them
    await new JsonRpcHttpClient([url]).fetch(
      {method: "engine_getBlobsV2", params: []},
      {times: new HttpRequestTimes()}
    );
    const STALL_MS = 40;
    let stalled = false;
    const stall = (): void => {
      if (stalled) return;
      stalled = true;
      const from = performance.now();
      while (performance.now() - from < STALL_MS);
    };
    subscribe("undici:request:bodySent", stall);
    try {
      const {root, milestones} = await verify(DispatchArm.treatment, {getBlobs: false});
      const gate = root.dispatchGate;
      expect(gate).toMatchObject({outcome: "new_payload_only", getBlobs: "none"});
      if (gate === null) throw Error("No gate");
      expect(gate.ms - gate.settledMs).toBeGreaterThanOrEqual(STALL_MS - 1);
      expect(gate.pastDeadlineMs).toBe(Math.round((gate.ms - 10) * 1000) / 1000);
      expect(root.waits.dispatchGate?.endMs).toBeLessThanOrEqual(milestones.state_transition_start as number);
      expect((root.waits.dispatchGate?.endMs as number) - (root.waits.dispatchGate?.beginMs as number)).toBeGreaterThan(
        STALL_MS
      );
    } finally {
      unsubscribe("undici:request:bodySent", stall);
    }
  });

  it("falls back at the deadline when newPayload waits behind an earlier engine request", async () => {
    forkchoiceDelayMs = 300;
    const {root, milestones} = await verify(DispatchArm.treatment, {
      getBlobs: false,
      beforeBlock: (engine) => {
        void engine.notifyForkchoiceUpdate(
          ForkName.fulu,
          `0x${"11".repeat(32)}`,
          `0x${"00".repeat(32)}`,
          `0x${"00".repeat(32)}`
        );
      },
    });
    const gate = root.dispatchGate;
    expect(gate).toMatchObject({outcome: "fell_back", getBlobs: "none"});
    if (gate === null) throw Error("No gate");
    expect(gate.settledMs).toBeGreaterThanOrEqual(9);
    expect(gate.ms).toBeGreaterThanOrEqual(gate.settledMs);
    expect(gate.ms).toBeLessThan(forkchoiceDelayMs / 2);
    // The state transition started without waiting for the queued request, which kept its order behind forkchoiceUpdated
    expect(milestones.execution_first_sent).toBeGreaterThan((milestones.state_transition_start as number) + STF_MS);
  });
});
