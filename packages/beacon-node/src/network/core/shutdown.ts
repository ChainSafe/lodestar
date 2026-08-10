import type {ConnectionManager} from "@libp2p/interface-internal";
import type {LoggerNode} from "@lodestar/logger/node";

const DIAL_QUEUE_DRAIN_TIMEOUT_MS = 5_000;

type ShutdownQueue = {
  stop(): void;
};

type DrainableDialQueue = ShutdownQueue & {
  queue: {
    onIdle(options?: {signal?: AbortSignal}): Promise<void>;
  };
};

type StoppableConnectionManager = ConnectionManager & {
  reconnectQueue: ShutdownQueue;
  dialQueue: DrainableDialQueue;
};

export enum NetworkShutdownErrorCode {
  CONNECTION_MANAGER_INCOMPATIBLE = "NETWORK_CONNECTION_MANAGER_INCOMPATIBLE",
  DIAL_QUEUE_DRAIN_FAILED = "NETWORK_DIAL_QUEUE_DRAIN_FAILED",
}

function isStoppableConnectionManager(
  connectionManager: ConnectionManager
): connectionManager is StoppableConnectionManager {
  const candidate = connectionManager as ConnectionManager & Partial<StoppableConnectionManager>;

  return (
    typeof candidate.reconnectQueue?.stop === "function" &&
    typeof candidate.dialQueue?.stop === "function" &&
    typeof candidate.dialQueue.queue?.onIdle === "function"
  );
}

/** Stop and drain outbound libp2p connection attempts without closing established connections. */
export async function stopAndDrainOutboundDials(
  connectionManager: ConnectionManager,
  logger: LoggerNode
): Promise<void> {
  if (!isStoppableConnectionManager(connectionManager)) {
    logger.warn("Unable to stop outbound network dials", {
      code: NetworkShutdownErrorCode.CONNECTION_MANAGER_INCOMPATIBLE,
    });
    return;
  }

  const pendingDials = connectionManager.getDialQueue().length;
  logger.debug("stopping outbound network dials", {pendingDials});

  connectionManager.reconnectQueue.stop();
  connectionManager.dialQueue.stop();

  try {
    await connectionManager.dialQueue.queue.onIdle({signal: AbortSignal.timeout(DIAL_QUEUE_DRAIN_TIMEOUT_MS)});
    logger.debug("outbound network dials stopped");
  } catch (e) {
    logger.warn(
      "Error draining outbound network dials",
      {code: NetworkShutdownErrorCode.DIAL_QUEUE_DRAIN_FAILED, pendingDials},
      e as Error
    );
  }
}
