import {TopicValidatorResult} from "@libp2p/gossipsub";
import {afterEach, beforeEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {config as defaultConfig} from "@lodestar/config/default";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {accept, ignore, reject} from "../../../../src/chain/beaconEngine/gossipValidationResult.js";
import {AttestationErrorCode} from "../../../../src/chain/errors/attestationError.js";
import {Metrics, createMetrics} from "../../../../src/metrics/index.js";
import {INetworkCore} from "../../../../src/network/core/index.js";
import {
  BatchGossipHandler,
  GossipHandlers,
  GossipMessageInfo,
  GossipType,
  SequentialGossipHandler,
} from "../../../../src/network/gossip/interface.js";
import {PeerAction} from "../../../../src/network/peers/index.js";
import {getGossipValidatorBatchFn, getGossipValidatorFn} from "../../../../src/network/processor/gossipValidatorFn.js";

describe("gossip result mapping", () => {
  const config = createBeaconConfig(defaultConfig, Buffer.alloc(32));
  const logger = testLogger();
  const reportPeer = vi.fn<INetworkCore["reportPeer"]>();
  const core = {reportPeer} as unknown as INetworkCore;
  const onFatalPeer = vi.fn();
  const handler = vi.fn<SequentialGossipHandler<GossipType.beacon_aggregate_and_proof>>();
  const batchHandler = vi.fn<BatchGossipHandler<GossipType.beacon_attestation>>();
  const handlers = {
    [GossipType.beacon_aggregate_and_proof]: handler,
    [GossipType.beacon_attestation]: batchHandler,
  } as unknown as GossipHandlers;
  const message: GossipMessageInfo = {
    topic: {type: GossipType.beacon_aggregate_and_proof, boundary: {fork: ForkName.phase0, epoch: 0}},
    msg: {type: "unsigned", topic: "test", data: new Uint8Array()},
    propagationSource: "peer",
    clientAgent: "test",
    clientVersion: "test",
    seenTimestampSec: 0,
    msgSlot: 0,
  };
  const batchMessage: GossipMessageInfo = {
    ...message,
    topic: {type: GossipType.beacon_attestation, boundary: {fork: ForkName.phase0, epoch: 0}, subnet: 0},
  };
  let metrics: Metrics;

  beforeEach(() => {
    vi.resetAllMocks();
    metrics = createMetrics({enabled: true, port: 0}, 0, [], {collectNodeMetrics: false});
  });

  afterEach(() => {
    metrics.close();
    vi.restoreAllMocks();
  });

  it("preserves sequential verdicts, metrics, and peer penalties", async () => {
    const validate = getGossipValidatorFn(handlers, {config, logger, core, metrics}, onFatalPeer);
    const accepted = vi.spyOn(metrics.networkProcessor.gossipValidationAccept, "inc");
    const ignored = vi.spyOn(metrics.networkProcessor.gossipValidationIgnore, "inc");
    const rejected = vi.spyOn(metrics.networkProcessor.gossipValidationReject, "inc");
    const errors = vi.spyOn(metrics.networkProcessor.gossipValidationError, "inc");
    const ignoreCode = AttestationErrorCode.ATTESTATION_ALREADY_KNOWN;
    const rejectCode = AttestationErrorCode.INVALID_SIGNATURE;

    handler.mockResolvedValueOnce(accept(undefined));
    expect(await validate(message)).toBe(TopicValidatorResult.Accept);
    handler.mockResolvedValueOnce(ignore(ignoreCode));
    expect(await validate(message)).toBe(TopicValidatorResult.Ignore);
    expect(reportPeer).not.toHaveBeenCalled();
    expect(onFatalPeer).not.toHaveBeenCalled();
    handler.mockResolvedValueOnce(reject(rejectCode));
    expect(await validate(message)).toBe(TopicValidatorResult.Reject);

    const topic = message.topic.type;
    expect(accepted).toHaveBeenCalledExactlyOnceWith({topic});
    expect(ignored).toHaveBeenCalledExactlyOnceWith({topic});
    expect(rejected).toHaveBeenCalledExactlyOnceWith({topic});
    expect(errors.mock.calls).toEqual([[{topic, error: ignoreCode}], [{topic, error: rejectCode}]]);
    expect(reportPeer).toHaveBeenCalledExactlyOnceWith("peer", PeerAction.Fatal, rejectCode);
    expect(onFatalPeer).toHaveBeenCalledExactlyOnceWith("peer");
  });

  it("maps mixed batch results without penalizing accepted or ignored peers", async () => {
    const validate = getGossipValidatorBatchFn(handlers, {config, logger, core, metrics}, onFatalPeer);
    const ignored = vi.spyOn(metrics.networkProcessor.gossipAttestationIgnoreByReason, "inc");
    const rejected = vi.spyOn(metrics.networkProcessor.gossipAttestationRejectByReason, "inc");
    const ignoreCode = AttestationErrorCode.ATTESTATION_ALREADY_KNOWN;
    const rejectCode = AttestationErrorCode.INVALID_SIGNATURE;
    batchHandler.mockResolvedValueOnce([accept({attestingIndices: [1]}), ignore(ignoreCode), reject(rejectCode)]);

    expect(
      await validate([
        {...batchMessage, propagationSource: "accepted"},
        {...batchMessage, propagationSource: "ignored"},
        {...batchMessage, propagationSource: "rejected"},
      ])
    ).toEqual([TopicValidatorResult.Accept, TopicValidatorResult.Ignore, TopicValidatorResult.Reject]);
    expect(ignored).toHaveBeenCalledExactlyOnceWith({reason: ignoreCode});
    expect(rejected).toHaveBeenCalledExactlyOnceWith({reason: rejectCode});
    expect(reportPeer).toHaveBeenCalledExactlyOnceWith("rejected", PeerAction.Fatal, rejectCode);
    expect(onFatalPeer).toHaveBeenCalledExactlyOnceWith("rejected");
  });

  it("ignores unexpected handler exceptions without validation penalties", async () => {
    const validate = getGossipValidatorFn(handlers, {config, logger, core, metrics}, onFatalPeer);
    const validateBatch = getGossipValidatorBatchFn(handlers, {config, logger, core, metrics}, onFatalPeer);
    const errors = vi.spyOn(metrics.networkProcessor.gossipValidationError, "inc");
    const rejected = vi.spyOn(metrics.networkProcessor.gossipValidationReject, "inc");
    const error = new Error("unexpected handler failure");
    handler.mockRejectedValueOnce(error);
    batchHandler.mockRejectedValueOnce(error);

    expect(await validate(message)).toBe(TopicValidatorResult.Ignore);
    expect(await validateBatch([batchMessage, batchMessage])).toEqual([
      TopicValidatorResult.Ignore,
      TopicValidatorResult.Ignore,
    ]);
    expect(errors).not.toHaveBeenCalled();
    expect(rejected).not.toHaveBeenCalled();
    expect(reportPeer).not.toHaveBeenCalled();
    expect(onFatalPeer).not.toHaveBeenCalled();
  });
});
