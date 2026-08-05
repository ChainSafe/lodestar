import {ApiClient} from "@lodestar/api";
import {Logger} from "@lodestar/utils";

export async function assertNodeReady(api: ApiClient, logger: Logger): Promise<void> {
  try {
    const versionRes = await api.node.getNodeVersionV2();
    const version = versionRes.value();
    logger.info("Node version", {
      beaconNode: `${version.beaconNode.name}/${version.beaconNode.version}`,
      executionClient: version.executionClient
        ? `${version.executionClient.name}/${version.executionClient.version}`
        : "unknown",
    });
  } catch {
    logger.warn("Failed to get node version");
  }

  const syncingStatusRes = await api.node.getSyncingStatus();

  if (!syncingStatusRes.ok) {
    throw Error("Cannot get node sync status");
  }

  const syncingStatus = syncingStatusRes.value();

  if (syncingStatus.isSyncing) {
    throw Error(
      `Beacon node is syncing: headSlot=${syncingStatus.headSlot} syncDistance=${syncingStatus.syncDistance}`
    );
  }

  if (syncingStatus.elOffline) {
    throw Error("Execution client is offline");
  }

  if (syncingStatus.isOptimistic) {
    logger.warn("Beacon node head is optimistic, execution payloads are not yet verified");
  }
}
