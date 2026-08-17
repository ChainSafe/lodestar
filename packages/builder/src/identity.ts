import {ApiClient, ApiError, HttpStatusCode, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {IClock} from "@lodestar/state-transition";
import {BuilderIndex, BuilderStatus} from "@lodestar/types";
import {ErrorAborted, Logger, sleep, toHex} from "@lodestar/utils";

export const WAITING_FOR_BUILDER_POLL_MS = 10 * 1000;

export async function resolveBuilderIdentity(
  api: ApiClient,
  logger: Logger,
  id: routes.beacon.BuilderId,
  signal: AbortSignal,
  clock: IClock,
  config: ChainForkConfig
): Promise<BuilderIndex> {
  const builderEntry = await waitForBuilder(api, logger, id, signal, clock, config);

  if (builderEntry.builder.version !== PAYLOAD_BUILDER_VERSION) {
    throw Error(`Builder version mismatch: got ${builderEntry.builder.version}, expected ${PAYLOAD_BUILDER_VERSION}`);
  }

  logger.info("Builder identity resolved", {
    index: builderEntry.index,
    status: builderEntry.status,
    balanceGwei: builderEntry.builder.balance,
    executionAddress: toHex(builderEntry.builder.executionAddress),
    slot: clock.getCurrentSlot(),
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
  signal: AbortSignal,
  clock: IClock,
  config: ChainForkConfig
): Promise<routes.beacon.BuilderResponse> {
  const gloasForkEpoch = config.GLOAS_FORK_EPOCH;
  while (!signal.aborted) {
    const currentEpoch = clock.getCurrentEpoch();
    if (currentEpoch < gloasForkEpoch) {
      // Builders only exist post-gloas, the beacon node returns an error for pre-gloas state
      logger.info("Waiting for Gloas fork before resolving builder identity", {
        gloasForkEpoch,
        currentEpoch,
        slot: clock.getCurrentSlot(),
      });
      await sleep(WAITING_FOR_BUILDER_POLL_MS, signal);
      continue;
    }

    let builder: routes.beacon.BuilderResponse | null = null;
    try {
      builder = await fetchBuilder(api, id);
    } catch (e) {
      // The clock gate above uses wall-clock epoch, but getStateBuilders reads the head block's post-state
      // (by root, not advanced to the current slot), so its fork follows the head block's slot rather than
      // wall-clock. Right at the boundary, while the head block is still in the last fulu epoch, that state
      // is pre-gloas and the endpoint returns a bad request even though wall-clock is already in gloas; it
      // only becomes gloas once a gloas-epoch block is head. Treat that as the transient and keep polling
      // (avoids differentiating on client-specific error text).
      if (e instanceof ApiError && e.status === HttpStatusCode.BAD_REQUEST) {
        logger.info("Waiting for Gloas state to be available at head", {
          gloasForkEpoch,
          currentEpoch,
          slot: clock.getCurrentSlot(),
        });
        await sleep(WAITING_FOR_BUILDER_POLL_MS, signal);
        continue;
      }
      throw e;
    }

    if (builder?.status === "active") {
      return builder;
    }
    if (builder?.status === "exited") {
      throw Error(`Builder exited: id=${id}`);
    }
    if (builder?.status === "pending") {
      logger.info("Waiting for builder deposit to be finalized", {id, slot: clock.getCurrentSlot()});
    } else {
      logger.info("Waiting for builder to be known to the beacon node", {id, slot: clock.getCurrentSlot()});
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
