import {ApiClient, routes} from "@lodestar/api";
import {PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {BuilderIndex, BuilderStatus} from "@lodestar/types";
import {ErrorAborted, Logger, sleep, toHex} from "@lodestar/utils";

export const WAITING_FOR_BUILDER_POLL_MS = 10 * 1000;

export async function resolveBuilderIdentity(
  api: ApiClient,
  logger: Logger,
  id: routes.beacon.BuilderId,
  signal: AbortSignal
): Promise<BuilderIndex> {
  const builderEntry = await waitForBuilder(api, logger, id, signal);

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
    if (builderEntry) {
      return {
        status: builderEntry.status,
        balance: builderEntry.builder.balance,
      };
    }
    logger.warn("Builder status not available in beacon node");
    return null;
  } catch (e) {
    logger.warn("Couldn't fetch the builder", {}, e as Error);
    return null;
  }
}

async function waitForBuilder(
  api: ApiClient,
  logger: Logger,
  id: routes.beacon.BuilderId,
  signal: AbortSignal
): Promise<routes.beacon.BuilderResponse> {
  while (!signal.aborted) {
    const builder = await fetchBuilder(api, id);
    if (builder?.status === "active") {
      return builder;
    }
    if (builder?.status === "exited") {
      throw Error(`Builder exited: id=${id}`);
    }
    if (builder?.status === "pending") {
      logger.info("Waiting for builder deposit to be finalized", {id});
    } else {
      logger.info("Waiting for builder to be known to the beacon node", {id});
    }
    await sleep(WAITING_FOR_BUILDER_POLL_MS, signal);
  }
  throw new ErrorAborted("waitForBuilder");
}

async function fetchBuilder(
  api: ApiClient,
  id: routes.beacon.BuilderId
): Promise<routes.beacon.BuilderResponse | null> {
  const builderRes = await api.beacon.getStateBuilders({
    stateId: "head",
    builderIds: [id],
  });

  const builders = builderRes.value();

  if (builders.length === 0) {
    return null;
  }

  const builder = builders[0];

  if (typeof id === "number") {
    if (id !== builder.index) {
      throw Error(`Index mismatch: got=${builder.index} expected=${id}`);
    }
  } else if (id !== toHex(builder.builder.pubkey)) {
    throw Error(`Pubkey mismatch: got=${toHex(builder.builder.pubkey)} expected=${id}`);
  }

  return builder;
}
