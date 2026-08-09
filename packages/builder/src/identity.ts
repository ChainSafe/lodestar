import {ApiClient, routes} from "@lodestar/api";
import {PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {BuilderIndex, BuilderStatus} from "@lodestar/types";
import {Logger, toHex} from "@lodestar/utils";

export async function resolveBuilderIdentity(
  api: ApiClient,
  logger: Logger,
  id: routes.beacon.BuilderId
): Promise<BuilderIndex> {
  const builderEntry = await fetchBuilder(api, id);

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
  try {
    const builderEntry = await fetchBuilder(api, id);
    return {
      status: builderEntry.status,
      balance: builderEntry.builder.balance,
    };
  } catch (e) {
    logger.warn("Couldn't fetch the builder", {}, e as Error);
    return null;
  }
}

async function fetchBuilder(api: ApiClient, id: routes.beacon.BuilderId): Promise<routes.beacon.BuilderResponse> {
  const builderRes = await api.beacon.getStateBuilders({
    stateId: "head",
    builderIds: [id],
  });

  if (!builderRes.ok) {
    await builderRes.errorBody();
    throw Error(`Failed to get builder state from beacon node: ${builderRes.status} - ${builderRes.error()?.message}`);
  }

  const builders = builderRes.value();

  if (builders.length === 0) {
    throw Error(`Builder not known to the beacon node: ${id}`);
  }

  return builders[0];
}
