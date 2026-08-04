import {ApiClient, routes} from "@lodestar/api";
import {PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {BuilderIndex, BuilderStatus} from "@lodestar/types";
import {Logger, toHex} from "@lodestar/utils";

export async function resolveBuilderIdentity(api: ApiClient, logger: Logger, id: string): Promise<BuilderIndex> {
  const builderEntry = await fetchBuilder(api, logger, id);

  if (builderEntry === null) {
    throw Error("Unable to retrieve the builder.");
  }

  if (builderEntry.status !== "active") {
    throw Error(`Builder not active: ${builderEntry.status}`);
  }

  if (builderEntry.builder.version !== PAYLOAD_BUILDER_VERSION) {
    throw Error(`Builder version mismatch: got ${builderEntry.builder.version}, expected ${PAYLOAD_BUILDER_VERSION}`);
  }

  logger.info("Builder identity resolved", {
    index: builderEntry.index,
    status: builderEntry.status,
    balanceGwei: builderEntry.builder.balance,
    executionAddress: toHex(builderEntry.builder.executionAddress),
  });

  return builderEntry.index;
}

export async function getBuilderStatus(
  api: ApiClient,
  logger: Logger,
  id: routes.beacon.BuilderId
): Promise<{status: BuilderStatus; balance: number} | null> {
  const builderEntry = await fetchBuilder(api, logger, id);

  if (builderEntry === null) return null;

  return {
    status: builderEntry.status,
    balance: builderEntry.builder.balance,
  };
}

async function fetchBuilder(
  api: ApiClient,
  logger: Logger,
  id: routes.beacon.BuilderId
): Promise<routes.beacon.BuilderResponse | null> {
  const builderRes = await api.beacon.getStateBuilders({
    stateId: "head",
    builderIds: [id],
  });

  if (!builderRes.ok) {
    logger.warn("Getting builder state from BN failed", {status: builderRes.status});
    return null;
  }

  const builders = builderRes.value();

  if (builders.length === 0) {
    logger.warn(`Builder not known to the BN: ${id}`);
    return null;
  }

  return builders[0];
}
