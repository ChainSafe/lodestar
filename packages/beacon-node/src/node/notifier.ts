import {BeaconConfig} from "@lodestar/config";
import {Epoch} from "@lodestar/types";
import {CachedBeaconStateAllForks, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {ProtoBlock, ExecutionStatus} from "@lodestar/fork-choice";
import {ErrorAborted, Logger, sleep, prettyBytes, prettyBytesShort} from "@lodestar/utils";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot, isExecutionCachedStateType, isMergeTransitionComplete} from "@lodestar/state-transition";
import {ExecutionEngineState} from "../execution/index.js";
import {IBeaconChain} from "../chain/index.js";
import {INetwork} from "../network/index.js";
import {IBeaconSync, SyncState} from "../sync/index.js";
import {prettyTimeDiffSec} from "../util/time.js";
import {TimeSeries} from "../util/timeSeries.js";

/** Create a warning log whenever the peer count is at or below this value */
const WARN_PEER_COUNT = 1;

type NodeNotifierModules = {
  network: INetwork;
  chain: IBeaconChain;
  sync: IBeaconSync;
  config: BeaconConfig;
  logger: Logger;
  signal: AbortSignal;
};

/**
 * Runs a notifier service that periodically logs information about the node.
 */
export async function runNodeNotifier(modules: NodeNotifierModules): Promise<void> {
  const {network, chain, sync, config, logger, signal} = modules;

  const headSlotTimeSeries = new TimeSeries({maxPoints: 10});
  const tdTimeSeries = new TimeSeries({maxPoints: 50});

  const SLOTS_PER_SYNC_COMMITTEE_PERIOD = SLOTS_PER_EPOCH * EPOCHS_PER_SYNC_COMMITTEE_PERIOD;
  let hasLowPeerCount = false;
  let isFirstTime = true;

  try {
    while (!signal.aborted) {
      const connectedPeerCount = network.getConnectedPeerCount();

      if (connectedPeerCount <= WARN_PEER_COUNT) {
        // Only log once and prevent peer count warning on startup
        if (!hasLowPeerCount && !isFirstTime) {
          logger.warn("Low peer count", {peers: connectedPeerCount});
          hasLowPeerCount = true;
        }
      } else {
        hasLowPeerCount = false;
      }

      const clockSlot = chain.clock.currentSlot;
      const clockEpoch = computeEpochAtSlot(clockSlot);

      if (
        clockEpoch >= config.BELLATRIX_FORK_EPOCH &&
        computeStartSlotAtEpoch(clockEpoch) === clockSlot &&
        chain.executionEngine.state === ExecutionEngineState.OFFLINE
      ) {
        logger.warn("Execution client is offline");
      }

      const headInfo = chain.forkChoice.getHead();
      const headState = chain.getHeadState();
      const finalizedEpoch = headState.finalizedCheckpoint.epoch;
      const finalizedRoot = headState.finalizedCheckpoint.root;
      const headSlot = headInfo.slot;
      headSlotTimeSeries.addPoint(headSlot, Math.floor(Date.now() / 1000));

      const peersRow = `peers: ${connectedPeerCount}`;
      const clockSlotRow = `slot: ${clockSlot}`;

      // Give info about empty slots if head < clock
      const skippedSlots = clockSlot - headInfo.slot;
      // headDiffInfo to have space suffix if its a non empty string
      const headDiffInfo =
        skippedSlots > 0 ? (skippedSlots > 1000 ? `${headInfo.slot} ` : `(slot -${skippedSlots}) `) : "";
      const headRow = `head: ${headDiffInfo}${prettyBytes(headInfo.blockRoot)}`;

      const executionInfo = getHeadExecutionInfo(config, clockEpoch, headState, headInfo);
      const finalizedCheckpointRow = `finalized: ${prettyBytes(finalizedRoot)}:${finalizedEpoch}`;

      // Log in TD progress in separate line to not clutter regular status update.
      // This line will only exist between BELLATRIX_FORK_EPOCH and TTD, a window of some days / weeks max.
      // Notifier log lines must be kept at a reasonable max width otherwise it's very hard to read
      const tdProgress = chain.eth1.getTDProgress();
      if (tdProgress !== null && !tdProgress.ttdHit) {
        tdTimeSeries.addPoint(tdProgress.tdDiffScaled, tdProgress.timestamp);

        const timestampTDD = tdTimeSeries.computeY0Point();
        // It is possible to get ttd estimate with an error at imminent merge
        const secToTTD = Math.max(Math.floor(timestampTDD - Date.now() / 1000), 0);
        const timeLeft = Number.isFinite(secToTTD) ? prettyTimeDiffSec(secToTTD) : "?";

        logger.info(`TTD in ${timeLeft} current TD ${tdProgress.td} / ${tdProgress.ttd}`);
      }

      let nodeState: string[];
      switch (sync.state) {
        case SyncState.SyncingFinalized:
        case SyncState.SyncingHead: {
          const slotsPerSecond = Math.max(headSlotTimeSeries.computeLinearSpeed(), 0);
          const distance = Math.max(clockSlot - headSlot, 0);
          const secondsLeft = distance / slotsPerSecond;
          const timeLeft = Number.isFinite(secondsLeft) ? prettyTimeDiffSec(secondsLeft) : "?";
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
      await sleep(timeToNextHalfSlot(config, chain, isFirstTime), signal);
      isFirstTime = false;
    }
  } catch (e) {
    if (e instanceof ErrorAborted) {
      return; // Ok
    } else {
      logger.error("Node notifier error", {}, e as Error);
    }
  }
}

function timeToNextHalfSlot(config: BeaconConfig, chain: IBeaconChain, isFirstTime: boolean): number {
  const msPerSlot = config.SECONDS_PER_SLOT * 1000;
  const msPerHalfSlot = msPerSlot / 2;
  const msFromGenesis = Date.now() - chain.genesisTime * 1000;
  const msToNextSlot =
    msFromGenesis < 0
      ? // For future genesis time, calculate time left in the slot
        -msFromGenesis % msPerSlot
      : // For past genesis time, calculate time until the next slot
        msPerSlot - (msFromGenesis % msPerSlot);
  if (isFirstTime) {
    // at the 1st time we may miss middle of the current clock slot
    return msToNextSlot > msPerHalfSlot ? msToNextSlot - msPerHalfSlot : msToNextSlot + msPerHalfSlot;
  } else {
    // after the 1st time always wait until middle of next clock slot
    return msToNextSlot + msPerHalfSlot;
  }
}

function getHeadExecutionInfo(
  config: BeaconConfig,
  clockEpoch: Epoch,
  headState: CachedBeaconStateAllForks,
  headInfo: ProtoBlock
): string[] {
  if (clockEpoch < config.BELLATRIX_FORK_EPOCH) {
    return [];
  } else {
    const executionStatusStr = headInfo.executionStatus.toLowerCase();

    // Add execution status to notifier only if head is on/post bellatrix
    if (isExecutionCachedStateType(headState)) {
      if (isMergeTransitionComplete(headState)) {
        const executionPayloadHashInfo =
          headInfo.executionStatus !== ExecutionStatus.PreMerge ? headInfo.executionPayloadBlockHash : "empty";
        const executionPayloadNumberInfo =
          headInfo.executionStatus !== ExecutionStatus.PreMerge ? headInfo.executionPayloadNumber : NaN;
        return [
          `exec-block: ${executionStatusStr}(${executionPayloadNumberInfo} ${prettyBytesShort(
            executionPayloadHashInfo
          )})`,
        ];
      } else {
        return [`exec-block: ${executionStatusStr}`];
      }
    } else {
      return [];
    }
  }
}
