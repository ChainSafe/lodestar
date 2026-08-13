import {ApiClient} from "@lodestar/api";
import {Logger, sleep} from "@lodestar/utils";

/** The time between polls when waiting for BN to be ready */
const WAITING_FOR_NODE_READY_POLL_MS = 5 * 1000;

export async function waitForNodeReady(api: ApiClient, logger: Logger, signal: AbortSignal): Promise<void> {
  while (!(await isNodeReady(api, logger))) {
    await sleep(WAITING_FOR_NODE_READY_POLL_MS, signal);
  }
}

async function isNodeReady(api: ApiClient, logger: Logger): Promise<boolean> {
  try {
    const syncingStatusRes = await api.node.getSyncingStatus();

    if (!syncingStatusRes.ok) {
      logger.warn("Cannot get node sync status", {
        status: syncingStatusRes.status,
        message: syncingStatusRes.error()?.message,
      });
      return false;
    }

    const syncingStatus = syncingStatusRes.value();

    if (syncingStatus.isSyncing || syncingStatus.elOffline) {
      logger.info(
        syncingStatus.elOffline ? "Beacon node EL is offline, unable to submit bids" : "Beacon node is not ready yet",
        {
          headSlot: syncingStatus.headSlot,
          syncDistance: syncingStatus.syncDistance,
          elOffline: syncingStatus.elOffline,
        }
      );
      return false;
    }

    logger.info("Beacon node is ready", {headSlot: syncingStatus.headSlot});

    if (syncingStatus.isOptimistic) {
      logger.warn("Beacon node head is optimistic, execution payloads are not yet verified");
    }

    return true;
  } catch (e) {
    logger.warn("Cannot reach the beacon node", {}, e as Error);
    return false;
  }
}

export async function logNodeVersion(api: ApiClient, logger: Logger): Promise<void> {
  try {
    const versionRes = await api.node.getNodeVersionV2();
    const version = versionRes.value();
    logger.info("Connected node version", {
      beaconNode: `${version.beaconNode.name}/${version.beaconNode.version}`,
      executionClient: version.executionClient
        ? `${version.executionClient.name}/${version.executionClient.version}`
        : "unknown",
    });
  } catch (e) {
    logger.warn("Failed to get node version", {}, e as Error);
  }
}
