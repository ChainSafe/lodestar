import {TopicValidatorResult} from "@libp2p/gossipsub";
import {describe, expect, it, vi} from "vitest";
import {GossipJob, GossipMessage, NativeTopicKind} from "@chainsafe/lodestar-z/network";
import {createBeaconConfig} from "@lodestar/config";
import {ForkName} from "@lodestar/params";
import {ssz} from "@lodestar/types";
import {defer} from "@lodestar/utils";
import {ChainEventEmitter} from "../../../../src/chain/emitter.js";
import {AttestationError, AttestationErrorCode, GossipAction} from "../../../../src/chain/errors/index.js";
import {IBeaconChain} from "../../../../src/chain/interface.js";
import {
  AttestationValidationResult,
  validateGossipAttestationsSameAttData,
  validateGossipVoluntaryExit,
} from "../../../../src/chain/validation/index.js";
import {IBeaconDb} from "../../../../src/db/interface.js";
import {INetworkCore} from "../../../../src/network/core/index.js";
import {NativeGossipExecutor} from "../../../../src/network/core/native/executor.js";
import {NativeGossip} from "../../../../src/network/core/native/gossip.js";
import {NetworkEventBus} from "../../../../src/network/events.js";
import {GossipType} from "../../../../src/network/gossip/interface.js";
import {stringifyGossipTopic} from "../../../../src/network/gossip/topic.js";
import {defaultNetworkOptions} from "../../../../src/network/options.js";
import {AggregatorTracker} from "../../../../src/network/processor/aggregatorTracker.js";
import {getGossipHandlers} from "../../../../src/network/processor/gossipHandlers.js";
import {getGossipValidatorFn} from "../../../../src/network/processor/gossipValidatorFn.js";
import {ClockStopped} from "../../../mocks/clock.js";
import {getMockedLogger} from "../../../mocks/loggerMock.js";

vi.mock("../../../../src/chain/validation/index.js", async (importActual) => {
  const mod = await importActual<typeof import("../../../../src/chain/validation/index.js")>();
  return {...mod, validateGossipAttestationsSameAttData: vi.fn(), validateGossipVoluntaryExit: vi.fn()};
});

const config = createBeaconConfig(
  {
    ALTAIR_FORK_EPOCH: 0,
    BELLATRIX_FORK_EPOCH: 0,
    CAPELLA_FORK_EPOCH: 0,
    DENEB_FORK_EPOCH: 0,
    ELECTRA_FORK_EPOCH: 0,
    FULU_FORK_EPOCH: Infinity,
    GLOAS_FORK_EPOCH: Infinity,
  },
  new Uint8Array(32)
);
const boundary = {fork: ForkName.electra, epoch: 0};

/**
 * The real gossip handlers behind the native host. `order` records handler work as it runs, and each forwarding
 * admission a test records by releasing a job's `reported`.
 */
function fixture() {
  const order: string[] = [];
  const chain = {
    config,
    clock: new ClockStopped(1),
    emitter: new ChainEventEmitter(),
    forkChoice: {onAttestation: vi.fn(() => order.push("attestation handler"))},
    opPool: {insertVoluntaryExit: vi.fn(() => order.push("exit handler"))},
    validatorMonitor: null,
  };
  const modules = {
    chain: chain as unknown as IBeaconChain,
    db: {} as IBeaconDb,
    config,
    logger: getMockedLogger(),
    metrics: null,
    events: new NetworkEventBus(),
    aggregatorTracker: new AggregatorTracker(),
    core: {} as INetworkCore,
  };
  const network = {publish: vi.fn(), blockImported: vi.fn(), dropQueuedGossip: vi.fn()};
  const gossip = new NativeGossip(network, config, modules.events, defaultNetworkOptions, vi.fn());
  const executor = new NativeGossipExecutor(modules, {}, gossip, vi.fn());
  return {order, chain, modules, gossip, executor};
}

/** A job whose owner holds its verdicts until the test releases them, which admits accepts to forwarding. */
function heldJob(kind: NativeTopicKind, messages: GossipMessage[], order: string[]) {
  const reported = defer<void>();
  const job: GossipJob = {kind, grouped: messages.length > 1, messages, reported: reported.promise};
  return {
    job,
    forward: () => {
      order.push("forwarded");
      reported.resolve();
    },
    close: () => reported.reject(Object.assign(new Error("NetworkClosed"), {code: "NetworkClosed"})),
  };
}

function message(type: GossipType.beacon_attestation | GossipType.voluntary_exit, id: number): GossipMessage {
  const attestation = type === GossipType.beacon_attestation;
  return {
    connection: {index: 0, generation: 1},
    peerId: "peer",
    topic: stringifyGossipTopic(config, attestation ? {type, boundary, subnet: 3} : {type, boundary}),
    id: new Uint8Array(20).fill(id),
    data: attestation
      ? new Uint8Array(8)
      : ssz.phase0.SignedVoluntaryExit.serialize(ssz.phase0.SignedVoluntaryExit.defaultValue()),
    receivedAtUnixMs: 0,
    slot: attestation ? 1n : null,
    attestationData: attestation ? "attestation data" : null,
  };
}

function accepted(validatorCommitteeIndex: number): {err: null; result: AttestationValidationResult} {
  return {
    err: null,
    result: {
      attestation: ssz.electra.SingleAttestation.defaultValue(),
      indexedAttestation: ssz.electra.IndexedAttestation.defaultValue(),
      subnet: 3,
      attDataRootHex: "0x00",
      committeeIndex: 0,
      validatorCommitteeIndex,
      committeeSize: 4,
    },
  };
}

/** Lets every timer the handler work could have scheduled become due and run. */
function timersDue(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 20));
}

describe("native gossip handler order", () => {
  it("runs a batch's handler work only after the owner disposed of its verdicts, in a later event loop", async () => {
    const f = fixture();
    vi.mocked(validateGossipAttestationsSameAttData).mockResolvedValue({
      results: [
        accepted(0),
        {err: new AttestationError(GossipAction.REJECT, {code: AttestationErrorCode.INVALID_SIGNATURE})},
        accepted(2),
      ],
      batchableBls: true,
    });
    const held = heldJob(
      "beacon_attestation",
      [1, 2, 3].map((id) => message(GossipType.beacon_attestation, id)),
      f.order
    );
    try {
      // Validation returns the verdicts while the owner still holds them.
      expect(await f.gossip.validate(held.job)).toEqual(["accept", "reject", "accept"]);
      await timersDue();
      expect(f.order).toEqual([]);
      held.forward();
      await Promise.resolve();
      await Promise.resolve();
      expect(f.order).toEqual(["forwarded"]);
      await timersDue();
      expect(f.order).toEqual(["forwarded", "attestation handler", "attestation handler"]);
    } finally {
      f.executor.stop();
    }
  });

  it("runs a single message's handler work only after forwarding admission, and never once the network closed", async () => {
    const f = fixture();
    vi.mocked(validateGossipVoluntaryExit).mockResolvedValue(undefined);
    const forwarded = heldJob("voluntary_exit", [message(GossipType.voluntary_exit, 1)], f.order);
    const closed = heldJob("voluntary_exit", [message(GossipType.voluntary_exit, 2)], f.order);
    try {
      expect(await f.gossip.validate(forwarded.job)).toEqual(["accept"]);
      expect(await f.gossip.validate(closed.job)).toEqual(["accept"]);
      await timersDue();
      expect(f.order).toEqual([]);
      closed.close();
      forwarded.forward();
      await timersDue();
      expect(f.order).toEqual(["forwarded", "exit handler"]);
    } finally {
      f.executor.stop();
    }
  });

  it("defers handler work to the next event loop where the result is reported synchronously", async () => {
    const f = fixture();
    vi.mocked(validateGossipVoluntaryExit).mockResolvedValue(undefined);
    const validate = getGossipValidatorFn(getGossipHandlers(f.modules, {}), f.modules);
    try {
      const result = await validate({
        topic: {type: GossipType.voluntary_exit, boundary},
        msg: {type: "unsigned", topic: "", data: message(GossipType.voluntary_exit, 1).data},
        propagationSource: "peer",
        clientAgent: "test",
        clientVersion: "test",
        seenTimestampSec: 0,
        msgSlot: null,
      });
      expect(result).toBe(TopicValidatorResult.Accept);
      expect(f.order).toEqual([]);
      await timersDue();
      expect(f.order).toEqual(["exit handler"]);
    } finally {
      f.executor.stop();
    }
  });
});
