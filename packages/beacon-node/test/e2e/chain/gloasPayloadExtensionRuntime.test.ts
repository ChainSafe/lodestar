import {afterEach, describe, expect, it, vi} from "vitest";
import {routes} from "@lodestar/api";
import {ChainConfig} from "@lodestar/config";
import {TimestampFormatCode} from "@lodestar/logger";
import {LogLevel, TestLoggerOpts, testLogger} from "@lodestar/logger/test-utils";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {RootHex} from "@lodestar/types";
import {toRootHex} from "@lodestar/utils";
import {PayloadError, PayloadErrorCode} from "../../../src/chain/blocks/importExecutionPayload.js";
import {TimelinessForkChoice} from "../../mocks/fork-choice/timeliness.js";
import {getDevBeaconNode} from "../../utils/node/beacon.js";
import {getAndInitDevValidators} from "../../utils/node/validator.js";

function classifyStateTransitionError(
  message: string
): "pre_state_not_gloas" | "process_execution_payload_envelope" | "state_root_mismatch" | "unknown" {
  if (message.startsWith("Expected gloas+ block state for payload import")) return "pre_state_not_gloas";
  if (message.startsWith("Envelope state root mismatch")) return "state_root_mismatch";
  if (message.length > 0) return "process_execution_payload_envelope";
  return "unknown";
}

function parseEnvelopeStateRootMismatch(message: string): {expected: RootHex; actual: RootHex} | null {
  const match = message.match(/Envelope state root mismatch expected=(0x[0-9a-f]+) actual=(0x[0-9a-f]+)/i);
  if (!match) return null;
  return {expected: match[1] as RootHex, actual: match[2] as RootHex};
}

describe("gloas runtime payload extension", () => {
  vi.setConfig({testTimeout: 180000});

  const validatorCount = 64;
  const SLOT_DURATION_MS = 2 * 1000;
  const weakHeadSlot = 34;
  const testParams: Partial<ChainConfig> = {
    SLOT_DURATION_MS,
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: 0,
    GLOAS_FORK_EPOCH: 1,
    REORG_PARENT_WEIGHT_THRESHOLD: 80,
    PROPOSER_SCORE_BOOST: 120,
    BLOB_SCHEDULE: [{EPOCH: 0, MAX_BLOBS_PER_BLOCK: 3}],
  };

  const afterEachCallbacks: (() => Promise<unknown> | void)[] = [];
  afterEach(async () => {
    while (afterEachCallbacks.length > 0) {
      const callback = afterEachCallbacks.pop();
      if (callback) await callback();
    }
  });

  async function waitUntil(predicate: () => boolean, timeoutMs: number, intervalMs = 250): Promise<void> {
    const start = Date.now();
    while (!predicate()) {
      if (Date.now() - start > timeoutMs) {
        throw new Error(`Condition not met within ${timeoutMs}ms`);
      }
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
    }
  }

  it("captures the shouldExtendPayload / payload-attributes / FCU bundle when runtime Gloas envelope import hits STATE_TRANSITION_ERROR", async () => {
    const genesisSlotsDelay = 7;
    const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * (SLOT_DURATION_MS / 1000);
    const testLoggerOpts: TestLoggerOpts = {
      level: LogLevel.info,
      timestampFormat: {
        format: TimestampFormatCode.EpochSlot,
        genesisTime,
        slotsPerEpoch: SLOTS_PER_EPOCH,
        secondsPerSlot: SLOT_DURATION_MS / 1000,
      },
    };
    const logger = testLogger("GloasRuntime", testLoggerOpts);

    const bn = await getDevBeaconNode({
      params: testParams,
      options: {
        sync: {isSingleNode: true},
        network: {allowPublishToZeroPeers: true, mdns: true, useWorker: false},
        chain: {
          blsVerifyAllMainThread: true,
          forkchoiceConstructor: TimelinessForkChoice,
          proposerBoost: true,
          proposerBoostReorg: true,
        },
      },
      validatorCount,
      genesisTime,
      logger,
    });
    afterEachCallbacks.push(async () => bn.close());

    (bn.chain.forkChoice as TimelinessForkChoice).lateSlot = weakHeadSlot;

    const shouldExtendCalls: {blockRoot: RootHex; proposerBoostRoot: RootHex; result: boolean}[] = [];
    const executionPayloadGossipEvents: {slot: number; stateRoot: RootHex; blockRoot: RootHex; blockHash: RootHex}[] =
      [];
    const fcuCalls: {payloadAttributes?: {parentBeaconBlockRoot?: Uint8Array}}[] = [];
    const errorSnapshots: {
      error: PayloadError;
      shouldExtendIndex: number;
      fcuIndex: number;
    }[] = [];

    const originalShouldExtend = bn.chain.forkChoice.shouldExtendPayload.bind(bn.chain.forkChoice);
    vi.spyOn(bn.chain.forkChoice, "shouldExtendPayload").mockImplementation((blockRoot) => {
      const result = originalShouldExtend(blockRoot);
      shouldExtendCalls.push({
        blockRoot,
        proposerBoostRoot: bn.chain.forkChoice.getProposerBoostRoot(),
        result,
      });
      return result;
    });

    bn.chain.emitter.on(routes.events.EventType.executionPayloadGossip, (event) => {
      executionPayloadGossipEvents.push(
        event as {slot: number; stateRoot: RootHex; blockRoot: RootHex; blockHash: RootHex}
      );
    });

    const originalFcu = bn.chain.executionEngine.notifyForkchoiceUpdate.bind(bn.chain.executionEngine);
    vi.spyOn(bn.chain.executionEngine, "notifyForkchoiceUpdate").mockImplementation(
      async (fork, headBlockHash, safeBlockHash, finalizedBlockHash, payloadAttributes) => {
        fcuCalls.push({payloadAttributes});
        return originalFcu(fork, headBlockHash, safeBlockHash, finalizedBlockHash, payloadAttributes);
      }
    );

    const originalProcessExecutionPayload = bn.chain.processExecutionPayload.bind(bn.chain);
    vi.spyOn(bn.chain, "processExecutionPayload").mockImplementation(async (...args) => {
      try {
        return await originalProcessExecutionPayload(...args);
      } catch (e) {
        if (e instanceof PayloadError) {
          errorSnapshots.push({
            error: e,
            shouldExtendIndex: shouldExtendCalls.length - 1,
            fcuIndex: fcuCalls.length - 1,
          });
        }
        throw e;
      }
    });

    const {validators} = await getAndInitDevValidators({
      node: bn,
      logPrefix: "vc-gloas-runtime",
      validatorsPerClient: validatorCount,
      validatorClientCount: 1,
      startIndex: 0,
      useRestApi: false,
      testLoggerOpts,
    });
    afterEachCallbacks.push(() => Promise.all(validators.map((v) => v.close())));

    await waitUntil(() => errorSnapshots.length > 0, 140000);

    const snapshot = errorSnapshots[0];
    const shouldExtend = shouldExtendCalls[snapshot.shouldExtendIndex];
    const fcuCall = fcuCalls
      .slice(0, snapshot.fcuIndex + 1)
      .reverse()
      .find((call) => call.payloadAttributes?.parentBeaconBlockRoot !== undefined);
    const branch = classifyStateTransitionError(snapshot.error.type.message);
    const mismatch = parseEnvelopeStateRootMismatch(snapshot.error.type.message);
    const gossipEvent = executionPayloadGossipEvents.at(-1);

    expect(snapshot.error.type.code).toBe(PayloadErrorCode.STATE_TRANSITION_ERROR);
    expect(branch).toBe("state_root_mismatch");
    expect(mismatch).not.toBeNull();
    expect(gossipEvent).toBeDefined();
    expect(shouldExtend).toBeDefined();
    expect(fcuCall).toBeDefined();
    expect(fcuCall?.payloadAttributes?.parentBeaconBlockRoot).toBeDefined();
    expect(toRootHex(fcuCall?.payloadAttributes?.parentBeaconBlockRoot as Uint8Array)).toEqual(shouldExtend.blockRoot);
    expect(gossipEvent?.stateRoot).toEqual(mismatch?.expected);
    expect(gossipEvent?.stateRoot).not.toEqual("0x" + "00".repeat(32));
    expect(mismatch?.actual).not.toEqual(mismatch?.expected);
    expect(mismatch?.actual).not.toEqual("0x" + "00".repeat(32));
  });
});
