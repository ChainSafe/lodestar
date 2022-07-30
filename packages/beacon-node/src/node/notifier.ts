import {IBeaconConfig} from "@lodestar/config";
import {ErrorAborted, ILogger, sleep, prettyBytes} from "@lodestar/utils";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot, isBellatrixCachedStateType, isMergeTransitionComplete} from "@lodestar/state-transition";
import {IBeaconChain} from "../chain/index.js";
import {INetwork} from "../network/index.js";
import {IBeaconSync, SyncState} from "../sync/index.js";
import {prettyTimeDiff} from "../util/time.js";
import {TimeSeries} from "../util/timeSeries.js";

/** Create a warning log whenever the peer count is at or below this value */
const WARN_PEER_COUNT = 1;

/**
 * Runs a notifier service that periodically logs information about the node.
 */
export async function runNodeNotifier({
  network,
  chain,
  sync,
  config,
  logger,
  signal,
}: {
  network: INetwork;
  chain: IBeaconChain;
  sync: IBeaconSync;
  config: IBeaconConfig;
  logger: ILogger;
  signal: AbortSignal;
}): Promise<void> {
  const SLOTS_PER_SYNC_COMMITTEE_PERIOD = SLOTS_PER_EPOCH * EPOCHS_PER_SYNC_COMMITTEE_PERIOD;
  const timeSeries = new TimeSeries({maxPoints: 10});
  let hasLowPeerCount = false; // Only log once
  /**
   * Should the td info for impending merge be shown in expanded form, once flipped on
   * should keep showing in expanded form
   */
  let expandedTDInfo = false;

  try {
    while (!signal.aborted) {
      const connectedPeerCount = network.getConnectedPeers().length;

      if (connectedPeerCount <= WARN_PEER_COUNT) {
        if (!hasLowPeerCount) {
          logger.warn("Low peer count", {peers: connectedPeerCount});
          hasLowPeerCount = true;
        }
      } else {
        hasLowPeerCount = false;
      }

      const clockSlot = chain.clock.currentSlot;
      const clockEpoch = computeEpochAtSlot(clockSlot);

      const headInfo = chain.forkChoice.getHead();
      const headState = chain.getHeadState();
      const finalizedEpoch = headState.finalizedCheckpoint.epoch;
      const finalizedRoot = headState.finalizedCheckpoint.root;
      const headSlot = headInfo.slot;
      timeSeries.addPoint(headSlot, Date.now());

      const peersRow = `peers: ${connectedPeerCount}`;
      const finalizedCheckpointRow = `finalized: ${prettyBytes(finalizedRoot)}:${finalizedEpoch}`;
      const headRow = `head: ${headInfo.slot} ${prettyBytes(headInfo.blockRoot)}`;

      let executionInfo: string[];
      if (clockEpoch >= config.BELLATRIX_FORK_EPOCH) {
        if (isBellatrixCachedStateType(headState) && isMergeTransitionComplete(headState)) {
          executionInfo = [
            `execution: ${headInfo.executionStatus.toLowerCase()}(${prettyBytes(
              headInfo.executionPayloadBlockHash ?? "empty"
            )})`,
          ];
        } else {
          // pre-merge
          const mergeData = chain.eth1.getMergeUpdate();
          if (mergeData !== null) {
            // See if we need to expand the td info
            let lastUpdate;
            if (mergeData.lastUpdate !== null) {
              const lastUpdateTime = `${prettyTimeDiff(Date.now() - mergeData.lastUpdate.time)} ago`;
              // This small trick gives us the %age in two decimal places
              const mergeCompletePercentage =
                Math.floor(Number((mergeData.lastUpdate.td * BigInt(10000)) / config.TERMINAL_TOTAL_DIFFICULTY)) / 100;
              if (expandedTDInfo === false) {
                // Either time to merge < 12 hours, or we are at 99% merge resolution
                expandedTDInfo =
                  (mergeData.mergeSecondsLeft !== null && mergeData.mergeSecondsLeft < 12 * 3600) ||
                  mergeCompletePercentage > 99.99;
              }
              if (expandedTDInfo) {
                lastUpdate = `${mergeData.lastUpdate.td} / ${config.TERMINAL_TOTAL_DIFFICULTY} - ${lastUpdateTime}`;
              } else {
                lastUpdate = `${mergeCompletePercentage}% of ${config.TERMINAL_TOTAL_DIFFICULTY} - ${lastUpdateTime}`;
              }
            } else {
              lastUpdate = "?";
            }

            const mergeSecondsLeft =
              mergeData.mergeSecondsLeft !== null ? `${prettyTimeDiff(1000 * mergeData.mergeSecondsLeft)}` : "?";
            executionInfo = [
              `execution: ${headInfo.executionStatus.toLowerCase()}(td: ${lastUpdate})`,
              `merge in: ${mergeSecondsLeft}`,
            ];
          } else {
            executionInfo = [`execution: ${headInfo.executionStatus.toLowerCase()}(merge not set)`];
          }
        }
      } else {
        executionInfo = [];
      }

      // Give info about empty slots if head < clock
      const skippedSlots = clockSlot - headInfo.slot;
      const clockSlotRow = `slot: ${clockSlot}` + (skippedSlots > 0 ? ` (skipped ${skippedSlots})` : "");

      let nodeState: string[];
      switch (sync.state) {
        case SyncState.SyncingFinalized:
        case SyncState.SyncingHead: {
          const slotsPerSecond = timeSeries.computeLinearSpeed();
          const distance = Math.max(clockSlot - headSlot, 0);
          const secondsLeft = distance / slotsPerSecond;
          const timeLeft = isFinite(secondsLeft) ? prettyTimeDiff(1000 * secondsLeft) : "?";
          // Syncing - time left - speed - head - finalized - clock - peers
          nodeState = [
            "Syncing",
            `${timeLeft} left`,
            `${slotsPerSecond.toPrecision(3)} slots/s`,
            clockSlotRow,
            headRow,
            ...executionInfo,
            finalizedCheckpointRow,
            peersRow,
          ];
          break;
        }

        case SyncState.Synced: {
          // Synced - clock - head - finalized - peers
          nodeState = ["Synced", clockSlotRow, headRow, ...executionInfo, finalizedCheckpointRow, peersRow];
          break;
        }

        case SyncState.Stalled: {
          // Searching peers - peers - head - finalized - clock
          nodeState = ["Searching peers", peersRow, clockSlotRow, headRow, ...executionInfo, finalizedCheckpointRow];
        }
      }
      logger.info(nodeState.join(" - "));

      // Log important chain time-based events
      // Log sync committee change
      if (clockEpoch > config.ALTAIR_FORK_EPOCH) {
        if (clockSlot % SLOTS_PER_SYNC_COMMITTEE_PERIOD === 0) {
          const period = Math.floor(clockEpoch / EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
          logger.info(`New sync committee period ${period}`);
        }
      }

      // Log halfway through each slot
      await sleep(timeToNextHalfSlot(config, chain), signal);
    }
  } catch (e) {
    if (e instanceof ErrorAborted) {
      return; // Ok
    } else {
      logger.error("Node notifier error", {}, e as Error);
    }
  }
}

function timeToNextHalfSlot(config: IBeaconConfig, chain: IBeaconChain): number {
  const msPerSlot = config.SECONDS_PER_SLOT * 1000;
  const msFromGenesis = Date.now() - chain.genesisTime * 1000;
  const msToNextSlot = msPerSlot - (msFromGenesis % msPerSlot);
  return msToNextSlot > msPerSlot / 2 ? msToNextSlot - msPerSlot / 2 : msToNextSlot + msPerSlot / 2;
}
