import type {ConnectionManager} from "@libp2p/interface-internal";
import {describe, expect, it, vi} from "vitest";
import type {LoggerNode} from "@lodestar/logger/node";
import {NetworkCore} from "../../../../src/network/core/networkCore.js";
import {NetworkShutdownErrorCode, stopAndDrainOutboundDials} from "../../../../src/network/core/shutdown.js";

vi.mock("@lodestar/state-transition", () => ({
  computeCommitteeCount: vi.fn(),
  computeEpochAtSlot: vi.fn(),
  computeShuffledIndex: vi.fn(),
  computeStartSlotAtEpoch: vi.fn(),
  computeTimeAtSlot: vi.fn(),
  newFilledArray: <T>(length: number, value: T) => Array.from({length}, () => value),
}));

type TestLogger = LoggerNode;

function createLogger(): TestLogger {
  return {
    debug: vi.fn(),
    warn: vi.fn(),
  } as unknown as TestLogger;
}

function createConnectionManager({
  calls,
  onIdle = async () => {},
}: {
  calls: string[];
  onIdle?: (options?: {signal?: AbortSignal}) => Promise<void>;
}): ConnectionManager & {closeConnections: ReturnType<typeof vi.fn>} {
  const closeConnections = vi.fn();

  return {
    getDialQueue: () => [{id: "pending-dial"}],
    closeConnections,
    reconnectQueue: {
      stop: () => calls.push("reconnectQueue.stop"),
    },
    dialQueue: {
      stop: () => calls.push("dialQueue.stop"),
      queue: {
        onIdle: async (options?: {signal?: AbortSignal}) => {
          calls.push("dialQueue.onIdle");
          await onIdle(options);
        },
      },
    },
  } as unknown as ConnectionManager & {closeConnections: ReturnType<typeof vi.fn>};
}

describe("network core shutdown", () => {
  it("stops reconnects and drains outbound dials without closing established connections", async () => {
    const calls: string[] = [];
    let idleSignal: AbortSignal | undefined;
    const connectionManager = createConnectionManager({
      calls,
      onIdle: async ({signal} = {}) => {
        idleSignal = signal;
      },
    });
    const logger = createLogger();

    await stopAndDrainOutboundDials(connectionManager, logger);

    expect(calls).toEqual(["reconnectQueue.stop", "dialQueue.stop", "dialQueue.onIdle"]);
    expect(idleSignal).toBeInstanceOf(AbortSignal);
    expect(connectionManager.closeConnections).not.toHaveBeenCalled();
    expect(logger.debug).toHaveBeenCalledWith("stopping outbound network dials", {pendingDials: 1});
    expect(logger.debug).toHaveBeenCalledWith("outbound network dials stopped");
  });

  it("continues shutdown when the connection manager internals are incompatible", async () => {
    const logger = createLogger();
    const connectionManager = {
      getDialQueue: () => [],
    } as unknown as ConnectionManager;

    await expect(stopAndDrainOutboundDials(connectionManager, logger)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith("Unable to stop outbound network dials", {
      code: NetworkShutdownErrorCode.CONNECTION_MANAGER_INCOMPATIBLE,
    });
  });

  it("continues shutdown when draining the dial queue fails", async () => {
    const calls: string[] = [];
    const logger = createLogger();
    const error = Error("dial queue did not drain");
    const connectionManager = createConnectionManager({
      calls,
      onIdle: async () => {
        throw error;
      },
    });

    await expect(stopAndDrainOutboundDials(connectionManager, logger)).resolves.toBeUndefined();

    expect(logger.warn).toHaveBeenCalledWith(
      "Error draining outbound network dials",
      {code: NetworkShutdownErrorCode.DIAL_QUEUE_DRAIN_FAILED, pendingDials: 1},
      error
    );
  });

  it("drains outbound dials before sending goodbye and stopping libp2p", async () => {
    const calls: string[] = [];
    const connectionManager = createConnectionManager({calls});
    const logger = createLogger();
    const core = new NetworkCore({
      libp2p: {
        services: {
          components: {
            connectionManager,
            transportManager: {stop: async () => calls.push("transportManager.stop")},
          },
        },
        stop: async () => calls.push("libp2p.stop"),
      },
      peerManager: {
        close: async () => calls.push("peerManager.close"),
        goodbyeAndDisconnectAllPeers: async () => calls.push("peerManager.goodbye"),
      },
      gossip: {stop: async () => calls.push("gossip.stop")},
      reqResp: {
        stop: async () => calls.push("reqResp.stop"),
        unregisterAllProtocols: async () => calls.push("reqResp.unregisterAllProtocols"),
      },
      attnetsService: {close: () => calls.push("attnetsService.close")},
      syncnetsService: {close: () => calls.push("syncnetsService.close")},
      clock: {
        on: vi.fn(),
        off: () => calls.push("clock.off"),
      },
      logger,
      networkConfig: {},
      peersData: {},
      metadata: {},
      config: {},
      statusCache: {},
      metrics: null,
      opts: {},
    } as unknown as ConstructorParameters<typeof NetworkCore>[0]);

    await core.close();

    expect(calls.indexOf("peerManager.close")).toBeLessThan(calls.indexOf("reconnectQueue.stop"));
    expect(calls.indexOf("reconnectQueue.stop")).toBeLessThan(calls.indexOf("dialQueue.stop"));
    expect(calls.indexOf("dialQueue.stop")).toBeLessThan(calls.indexOf("dialQueue.onIdle"));
    expect(calls.indexOf("dialQueue.onIdle")).toBeLessThan(calls.indexOf("peerManager.goodbye"));
    expect(calls.indexOf("peerManager.goodbye")).toBeLessThan(calls.indexOf("libp2p.stop"));
  });
});
