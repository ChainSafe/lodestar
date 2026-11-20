import {ApiClient, ApiError, HttpStatusCode, routes} from "@lodestar/api";
import {BeaconConfig} from "@lodestar/config";
import {FAR_FUTURE_EPOCH, PAYLOAD_BUILDER_VERSION} from "@lodestar/params";
import {IClock, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {BuilderIndex, BuilderStatus, ssz} from "@lodestar/types";
import {ErrorAborted, Logger, TimeoutError, fromHex, isFetchError, retry, sleep, toHex} from "@lodestar/utils";

/**
 * Identity of a builder deposited before the Gloas fork, asserted by the operator. The fork upgrade onboards
 * the deposit and the beacon node only knows the builder once the first Gloas block is the head, which is too
 * late to bid for that block. The status tracker verifies the assumption against the registry after the fork.
 */
export type AssumedBuilderIdentity = {
  index: BuilderIndex;
  balanceGwei: number;
};

export async function resolveBuilderIdentity(
  api: ApiClient,
  logger: Logger,
  id: routes.beacon.BuilderId,
  signal: AbortSignal,
  clock: IClock,
  config: BeaconConfig,
  assumed?: AssumedBuilderIdentity
): Promise<routes.beacon.BuilderResponse> {
  const builderEntry = await waitForBuilder(api, logger, id, signal, clock, config, assumed);

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

  return builderEntry;
}

/** Additional gossip keys must already be registered; never wait for a deposit during primary startup. */
export async function resolveGossipBuilderIdentity(
  api: ApiClient,
  pubkey: string,
  signal: AbortSignal
): Promise<routes.beacon.BuilderResponse> {
  const response = await retry(
    async () => {
      const result = await api.beacon.getStateBuilders(
        {stateId: "head", builderIds: [pubkey]},
        {signal, timeoutMs: 2000}
      );
      result.assertOk();
      return result;
    },
    {
      retries: 1,
      retryDelay: 100,
      signal,
      shouldRetry: (error) =>
        error instanceof ApiError ? error.status >= 500 : error instanceof TimeoutError || isFetchError(error),
    }
  );
  const entries = response.value();
  if (entries.length !== 1 || toHex(entries[0].builder.pubkey) !== pubkey) throw Error("GOSSIP_BUILDER_NOT_REGISTERED");
  if (entries[0].builder.version !== PAYLOAD_BUILDER_VERSION) throw Error("GOSSIP_BUILDER_VERSION_MISMATCH");
  return entries[0];
}

export async function getBuilderStatus(
  api: ApiClient,
  logger: Logger,
  id: routes.beacon.BuilderId
): Promise<{index: BuilderIndex; status: BuilderStatus; balance: number} | null> {
  try {
    const builderEntry = await fetchBuilder(api, logger, id);
    if (builderEntry) {
      return {
        index: builderEntry.index,
        status: builderEntry.status,
        balance: builderEntry.builder.balance,
      };
    }
    logger.warn("Builder status not available in beacon node");
    return null;
  } catch (e) {
    if (e instanceof ApiError && e.status === HttpStatusCode.BAD_REQUEST) {
      // A builder resolved ahead of the fork is not known to the beacon node until the first Gloas block is the head
      logger.debug("Builder registry is not available at head yet");
      return null;
    }
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
  config: BeaconConfig,
  assumed?: AssumedBuilderIdentity
): Promise<routes.beacon.BuilderResponse> {
  const gloasForkEpoch = config.GLOAS_FORK_EPOCH;
  while (!signal.aborted) {
    const currentEpoch = clock.getCurrentEpoch();
    if (currentEpoch < gloasForkEpoch) {
      const forkSlot = computeStartSlotAtEpoch(gloasForkEpoch);
      if (assumed !== undefined) {
        logger.info("Assuming builder identity until the Gloas fork", {
          id,
          index: assumed.index,
          balanceGwei: assumed.balanceGwei,
          forkSlot,
        });
        return assumedBuilderResponse(id, assumed);
      }
      // Builders only exist post-gloas, the beacon node returns an error for pre-gloas state
      logger.info("Waiting for Gloas fork before resolving builder identity", {
        gloasForkEpoch,
        currentEpoch,
        slot: clock.getCurrentSlot(),
      });
      await sleep(clock.msToSlot(Math.min(computeStartSlotAtEpoch(currentEpoch + 1), forkSlot)), signal);
      continue;
    }

    let builder: routes.beacon.BuilderResponse | null = null;
    try {
      builder = await fetchBuilder(api, logger, id);
    } catch (e) {
      // At the fork boundary getStateBuilders("head") can still 400: it serves the head block's
      // post-state, which stays pre-gloas until a gloas-epoch block is head. Keep polling on the transient.
      if (e instanceof ApiError && e.status === HttpStatusCode.BAD_REQUEST) {
        logger.info("Waiting for Gloas state to be available at head", {
          gloasForkEpoch,
          currentEpoch,
          slot: clock.getCurrentSlot(),
        });
        await sleep(msToNextSlotPoll(clock), signal);
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
    await sleep(msToNextSlotPoll(clock), signal);
  }
  throw new ErrorAborted("waitForBuilder");
}

async function fetchBuilder(
  api: ApiClient,
  logger: Logger,
  id: routes.beacon.BuilderId
): Promise<routes.beacon.BuilderResponse | null> {
  try {
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
  } catch (e) {
    if (e instanceof TimeoutError || (isFetchError(e) && e.type !== "input")) {
      logger.warn("Failed to fetch builder", {message: e.message});
      return null;
    }
    throw e;
  }
}

function assumedBuilderResponse(
  id: routes.beacon.BuilderId,
  assumed: AssumedBuilderIdentity
): routes.beacon.BuilderResponse {
  const builder = ssz.gloas.Builder.defaultValue();
  if (typeof id === "string") {
    builder.pubkey = fromHex(id);
  }
  builder.version = PAYLOAD_BUILDER_VERSION;
  builder.balance = assumed.balanceGwei;
  builder.withdrawableEpoch = FAR_FUTURE_EPOCH;
  return {index: assumed.index, status: "active", builder};
}

function msToNextSlotPoll(clock: IClock): number {
  return clock.msToSlot(clock.getCurrentSlot() + 1);
}
