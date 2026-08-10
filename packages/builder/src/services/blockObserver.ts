import {ApiClient, ApiError, routes} from "@lodestar/api";
import {ChainForkConfig} from "@lodestar/config";
import {ForkPostGloas, isForkPostGloas} from "@lodestar/params";
import {RootHex, SignedBeaconBlock, Slot, gloas, isGloasBeaconBlock} from "@lodestar/types";
import {Logger, isErrorAborted, pruneSetToMax, retry, toRootHex} from "@lodestar/utils";

const {EventType} = routes.events;

type BlockEvent = routes.events.EventData[typeof EventType.block];

type BlockObserverOptions = {
  retries?: number;
  retryDelay?: number;
  maxSeenBlockRoots?: number;
};

export type ObservedBlock = {
  blockRoot: RootHex;
  slot: Slot;
  executionOptimistic: boolean;
  version: ForkPostGloas;
  block: SignedBeaconBlock<ForkPostGloas>;
  signedBid: gloas.SignedExecutionPayloadBid;
};

type RunOnBlockFn = (block: ObservedBlock) => Promise<void>;

/**
 * Observes imported beacon blocks through the source beacon node API.
 *
 * Each block root is evaluated at most once while retained in the bounded seen set. Terminal failures remain consumed
 * until normal FIFO eviction; reconnect, replay, and recovery policies are handled separately.
 */
export class BlockObserver {
  private readonly fns: RunOnBlockFn[] = [];
  private readonly seenBlockRoots = new Set<RootHex>();
  private readonly retries: number;
  private readonly retryDelay: number;
  private readonly maxSeenBlockRoots: number;

  constructor(
    private readonly config: ChainForkConfig,
    private readonly logger: Logger,
    private readonly api: ApiClient,
    {retries = 5, retryDelay = 200, maxSeenBlockRoots = 256}: BlockObserverOptions = {}
  ) {
    this.retries = retries;
    this.retryDelay = retryDelay;
    this.maxSeenBlockRoots = maxSeenBlockRoots;
  }

  runOnBlock(fn: RunOnBlockFn): void {
    this.fns.push(fn);
  }

  start(signal: AbortSignal): void {
    this.logger.info("Block observer started");

    this.api.events
      .eventstream({
        topics: [EventType.block],
        signal,
        onEvent: (event) => {
          if (event.type !== EventType.block) {
            this.logger.debug("Ignoring unexpected beacon event", {eventType: event.type});
            return;
          }

          void this.processBlockEvent(event.message, signal);
        },
        onError: (error) => {
          this.logger.error("Failed to receive block event", {}, error);
        },
        onClose: () => {
          this.logger.debug("Closed stream for block events");
        },
      })
      .catch((error: unknown) => {
        this.logger.error(
          "Failed to subscribe to block events",
          {},
          error instanceof Error ? error : Error(String(error))
        );
      });
  }

  async processBlockEvent(event: BlockEvent, signal: AbortSignal): Promise<void> {
    try {
      const {slot, block: blockRoot, executionOptimistic} = event;

      if (this.seenBlockRoots.has(blockRoot)) {
        this.logger.debug("Ignoring duplicate block event", {slot, blockRoot});
        return;
      }

      this.seenBlockRoots.add(blockRoot);
      pruneSetToMax(this.seenBlockRoots, this.maxSeenBlockRoots);

      if (!isForkPostGloas(this.config.getForkName(slot))) {
        this.logger.debug("Ignoring pre-Gloas block event", {slot, blockRoot});
        return;
      }

      const response = await retry(
        async () => {
          const result = await this.api.beacon.getBlockV2({blockId: blockRoot}, {signal});
          result.assertOk();
          return result;
        },
        {
          retries: this.retries,
          retryDelay: this.retryDelay,
          signal,
          shouldRetry: isRetryableBlockRetrievalError,
          onRetry: (error, attempt) => {
            this.logger.debug("Retrying block retrieval", {
              slot,
              blockRoot,
              attempt,
              error: error.message,
            });
          },
        }
      ).catch((error: unknown) => {
        if (isErrorAborted(error)) {
          return null;
        }

        this.logger.error(
          "Failed to retrieve block referenced by block event",
          {slot, blockRoot},
          error instanceof Error ? error : Error(String(error))
        );
        return null;
      });

      if (response === null) {
        return;
      }

      const {version} = response.meta();
      if (!isForkPostGloas(version)) {
        this.logger.warn("Ignoring block with unsupported fork version", {slot, blockRoot, fork: version});
        return;
      }

      const block = response.value();
      if (!isGloasBeaconBlock(block.message)) {
        this.logger.error("Block response version and body do not agree", {slot, blockRoot, fork: version});
        return;
      }

      const postGloasBlock = block as SignedBeaconBlock<ForkPostGloas>;
      const signedBid = postGloasBlock.message.body.signedExecutionPayloadBid;
      const observedBlock: ObservedBlock = {
        blockRoot,
        slot,
        executionOptimistic,
        version,
        block: postGloasBlock,
        signedBid,
      };

      this.logger.debug("Observed post-Gloas block", {
        slot,
        blockRoot,
        fork: version,
        builderIndex: signedBid.message.builderIndex,
        value: signedBid.message.value,
        blockHash: toRootHex(signedBid.message.blockHash),
        parentBlockHash: toRootHex(signedBid.message.parentBlockHash),
      });

      await Promise.all(
        this.fns.map(async (fn) => {
          try {
            await fn(observedBlock);
          } catch (error) {
            this.logger.error(
              "Failed to process observed block",
              {slot, blockRoot},
              error instanceof Error ? error : Error(String(error))
            );
          }
        })
      );
    } catch (error) {
      if (isErrorAborted(error)) {
        return;
      }

      this.logger.error(
        "Failed to process block event",
        {slot: event.slot, blockRoot: event.block},
        error instanceof Error ? error : Error(String(error))
      );
    }
  }
}

export function isRetryableBlockRetrievalError(error: Error): boolean {
  if (error instanceof ApiError) {
    return error.status === 404 || error.status >= 500;
  }

  return !isErrorAborted(error);
}
