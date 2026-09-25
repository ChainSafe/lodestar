import http from "node:http";
import {AddressInfo} from "node:net";
import {afterAll, beforeAll, beforeEach, describe, expect, it, vi} from "vitest";
import {createChainForkConfig, defaultChainConfig} from "@lodestar/config";
import {ForkName, SLOTS_PER_EPOCH} from "@lodestar/params";
import {DataAvailabilityStatus, IBeaconStateView} from "@lodestar/state-transition";
import {ssz} from "@lodestar/types";
import {BlockInputColumns, BlockInputSource} from "../../../../src/chain/blocks/blockInput/index.js";
import {DispatchArm, DispatchGateSwitch, firstArmOfPair} from "../../../../src/chain/blocks/dispatchGate.js";
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
import {JsonRpcHttpClient} from "../../../../src/execution/engine/jsonRpcHttpClient.js";
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

  /** Verifies a live Fulu gossip block in `arm`, with a blob unless `noBlobs`, returning its trace root */
  async function verify(
    arm: DispatchArm,
    opts: {getBlobs: boolean; noBlobs?: boolean; beforeBlock?: (engine: ExecutionEngineHttp) => void}
  ) {
    const logger = getMockedLogger();
    const clock = new ClockStopped(slot);
    const abort = new AbortController();
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
    const chain = {
      config,
      logger,
      metrics: null,
      validatorMonitor: null,
      executionEngine,
      dispatchGate,
      getBlobsTracker,
      seenBlockProposers: new SeenBlockProposers(),
      regen: {getPreState: async () => preState},
      shufflingCache: {processState: () => {}},
    } as unknown as BeaconChain;

    const block = ssz.fulu.SignedBeaconBlock.defaultValue();
    block.message.slot = slot;
    block.message.body.blobKzgCommitments = opts.noBlobs ? [] : [new Uint8Array(48)];
    const blockInput = BlockInputColumns.createFromBlock({
      forkName: ForkName.fulu,
      block,
      blockRootHex: "0xaa",
      source: BlockInputSource.gossip,
      seenTimestampSec: Date.now() / 1000,
      daOutOfRange: false,
      sampledColumns: [0],
      custodyColumns: [0],
    });

    try {
      opts.beforeBlock?.(executionEngine);
      // As the gossip block handler does, getBlobs is triggered before the block is processed
      if (opts.getBlobs) getBlobsTracker.triggerGetBlobs(blockInput);
      const attempt = blockTrace.startAttempt([blockInput], performance.now());
      await verifyBlocksInEpoch.call(
        chain,
        generateProtoBlock({slot: slot - 1}),
        [blockInput],
        null,
        {seenTimestampSec: Date.now() / 1000},
        attempt
      );
      const {milestoneNames, slots} = blockTrace.getSnapshot();
      const root = slots[0].roots[0];
      const milestones = Object.fromEntries(milestoneNames.map((name, i) => [name, root.milestones[i]]));
      return {root, milestones};
    } finally {
      abort.abort();
    }
  }

  it("hands newPayload and getBlobs to the connection before the state transition starts when the gate succeeds", async () => {
    const {root, milestones} = await verify(DispatchArm.treatment, {getBlobs: true});
    expect(root.arm).toBe(DispatchArm.treatment);
    expect(root.dispatchGate).toMatchObject({outcome: "both_sent", getBlobs: "pending", overshootMs: null});
    const {execution_dispatch, getblobs_dispatch, state_transition_start} = milestones;
    expect(execution_dispatch).not.toBeNull();
    expect(getblobs_dispatch).not.toBeNull();
    expect(execution_dispatch).toBeLessThan(state_transition_start as number);
    expect(getblobs_dispatch).toBeLessThan(state_transition_start as number);
    expect(root.waits.dispatchGate?.endMs).toBeLessThanOrEqual(state_transition_start as number);
    expect(Number.isNaN(stfStart)).toBe(false);
  });

  it("ends the wait when the triggered getBlobs call skips its request", async () => {
    const {root, milestones} = await verify(DispatchArm.treatment, {getBlobs: true, noBlobs: true});
    expect(root.dispatchGate).toMatchObject({outcome: "new_payload_only", getBlobs: "pending"});
    expect(milestones.getblobs_request).toBeNull();
    expect(milestones.execution_dispatch).toBeLessThan(milestones.state_transition_start as number);
  });

  it("sends newPayload only after the synchronous state transition in the control arm", async () => {
    const {root, milestones} = await verify(DispatchArm.control, {getBlobs: false});
    expect(root.arm).toBe(DispatchArm.control);
    expect(root.dispatchGate).toBeNull();
    expect(milestones.execution_dispatch).toBeGreaterThanOrEqual(
      (milestones.state_transition_start as number) + STF_MS
    );
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
    expect(gate.ms).toBeGreaterThanOrEqual(9);
    expect(gate.ms).toBeLessThan(forkchoiceDelayMs / 2);
    // The state transition started without waiting for the queued request, which kept its order behind forkchoiceUpdated
    expect(milestones.execution_dispatch).toBeGreaterThan((milestones.state_transition_start as number) + STF_MS);
  });
});
