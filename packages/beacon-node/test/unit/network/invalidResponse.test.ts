import {generateKeyPair} from "@libp2p/crypto/keys";
import {afterEach, describe, expect, it, vi} from "vitest";
import {createBeaconConfig} from "@lodestar/config";
import {testLogger} from "@lodestar/logger/test-utils";
import {ForkName} from "@lodestar/params";
import {RequestError, RequestErrorCode, ResponseIncoming} from "@lodestar/reqresp";
import {ssz} from "@lodestar/types";
import {LogLevel} from "@lodestar/utils";
import {INetworkCore} from "../../../src/network/core/types.js";
import {NetworkEventBus} from "../../../src/network/events.js";
import {Network} from "../../../src/network/network.js";
import {defaultNetworkOptions} from "../../../src/network/options.js";
import {PeerAction} from "../../../src/network/peers/index.js";
import {AggregatorTracker} from "../../../src/network/processor/aggregatorTracker.js";
import {NetworkProcessor} from "../../../src/network/processor/index.js";
import {ClockStopped} from "../../mocks/clock.js";
import {getMockedBeaconChain} from "../../mocks/mockedBeaconChain.js";
import {getMockedBeaconDb} from "../../mocks/mockedBeaconDb.js";

const logger = testLogger();
afterEach(() => vi.restoreAllMocks());

const peerId = "response-peer";
const root = new Uint8Array(32);
const senders: Record<string, (network: Network) => Promise<unknown>> = {
  blocksByRange: (network) => network.sendBeaconBlocksByRange(peerId, {startSlot: 0, count: 1, step: 1}),
  blocksByRoot: (network) => network.sendBeaconBlocksByRoot(peerId, [root]),
  blocksByHead: (network) =>
    network.sendBeaconBlocksByHead(peerId, {...ssz.fulu.BeaconBlocksByHeadRequest.defaultValue(), count: 1}),
  bootstrap: (network) => network.sendLightClientBootstrap(peerId, root),
  optimisticUpdate: (network) => network.sendLightClientOptimisticUpdate(peerId),
  finalityUpdate: (network) => network.sendLightClientFinalityUpdate(peerId),
  updatesByRange: (network) => network.sendLightClientUpdatesByRange(peerId, {startPeriod: 0, count: 1}),
  columnsByRange: (network) => network.sendDataColumnSidecarsByRange(peerId, {startSlot: 0, count: 1, columns: [0]}),
  columnsByRoot: (network) => network.sendDataColumnSidecarsByRoot(peerId, [{blockRoot: root, columns: [0]}]),
  envelopesByRange: (network) => network.sendExecutionPayloadEnvelopesByRange(peerId, {startSlot: 0, count: 1}),
  envelopesByRoot: (network) => network.sendExecutionPayloadEnvelopesByRoot(peerId, [root]),
};

async function fixture() {
  const config = createBeaconConfig({}, root);
  const chain = {...getMockedBeaconChain(), clock: new ClockStopped(0), config};
  const events = new NetworkEventBus();
  const aggregatorTracker = new AggregatorTracker();
  const reportPeer = vi.fn<INetworkCore["reportPeer"]>().mockResolvedValue(undefined);
  const sendReqRespRequest = vi.fn<INetworkCore["sendReqRespRequest"]>().mockImplementation(async function* () {
    yield {data: new Uint8Array(1), fork: ForkName.fulu, protocolVersion: 2};
  });
  const core = {close: async () => {}, reportPeer, sendReqRespRequest} as unknown as INetworkCore;
  const networkProcessor = new NetworkProcessor(
    {chain, db: getMockedBeaconDb(), config, logger, metrics: null, events, core, aggregatorTracker},
    {}
  );
  const network = new Network({
    opts: defaultNetworkOptions,
    privateKey: await generateKeyPair("secp256k1"),
    config,
    chain,
    logger,
    networkEventBus: events,
    networkProcessor,
    core,
    aggregatorTracker,
  });
  return {network, reportPeer, sendReqRespRequest, logger};
}

describe.each(Object.entries(senders))("%s peer reporting", (_name, send) => {
  it("reports the responder exactly once when deserialization fails", async () => {
    const {network, reportPeer} = await fixture();
    try {
      await expect(send(network)).rejects.toMatchObject({type: {code: RequestErrorCode.INVALID_RESPONSE_SSZ}});
      expect(reportPeer).toHaveBeenCalledExactlyOnceWith(peerId, PeerAction.LowToleranceError, "InvalidResponseSsz", undefined);
    } finally {
      await network.close();
    }
  });

  it("does not re-report an error already raised by the transport", async () => {
    const {network, reportPeer, sendReqRespRequest} = await fixture();
    const error = new RequestError({code: RequestErrorCode.INVALID_RESPONSE_SSZ, errorMessage: "framing"});
    sendReqRespRequest.mockReturnValue({
      [Symbol.asyncIterator](): AsyncIterator<ResponseIncoming> {
        return {next: async () => Promise.reject(error)};
      },
    });
    try {
      await expect(send(network)).rejects.toBe(error);
      expect(reportPeer).not.toHaveBeenCalled();
    } finally {
      await network.close();
    }
  });
});

it("reports malformed SSZ offsets within the permitted response size", async () => {
  const {network, reportPeer, sendReqRespRequest} = await fixture();
  const type = ssz.phase0.SignedBeaconBlock;
  const data = type.serialize(type.defaultValue());
  new DataView(data.buffer, data.byteOffset, data.byteLength).setUint32(0, 0, true);
  expect(data.length).toBeGreaterThanOrEqual(type.minSize);
  expect(data.length).toBeLessThanOrEqual(type.maxSize);
  expect(() => type.deserialize(data)).toThrow();
  sendReqRespRequest.mockImplementation(async function* () {
    yield {data, fork: ForkName.phase0, protocolVersion: 1};
  });
  try {
    await expect(senders.blocksByRoot(network)).rejects.toMatchObject({
      type: {code: RequestErrorCode.INVALID_RESPONSE_SSZ},
    });
    expect(reportPeer).toHaveBeenCalledExactlyOnceWith(peerId, PeerAction.LowToleranceError, "InvalidResponseSsz", undefined);
  } finally {
    await network.close();
  }
});

it.each([false, true])("preserves the SSZ error when peer reporting fails (synchronous: %s)", async (synchronous) => {
  const {network, reportPeer, logger} = await fixture();
  const error = new Error("peer reporter closed");
  reportPeer.mockImplementation(() => {
    if (synchronous) throw error;
    return Promise.reject(error);
  });
  const log = vi.spyOn(logger, LogLevel.debug).mockImplementation(() => {});
  try {
    await expect(senders.blocksByRange(network)).rejects.toMatchObject({
      type: {code: RequestErrorCode.INVALID_RESPONSE_SSZ},
    });
    expect(reportPeer).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("Failed to report invalid response", {peerId}, error);
  } finally {
    await network.close();
  }
});
