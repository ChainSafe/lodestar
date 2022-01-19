import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ErrorAborted, ILogger, sleep, prettyBytes} from "@chainsafe/lodestar-utils";
import {AbortSignal} from "@chainsafe/abort-controller";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {computeEpochAtSlot, bellatrix} from "@chainsafe/lodestar-beacon-state-transition";
import {IBeaconChain} from "../chain";
import {INetwork} from "../network";
import {IBeaconSync, SyncState} from "../sync";
import {prettyTimeDiff} from "../util/time";
import {TimeSeries} from "../util/timeSeries";

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
      const finalizedRoot = headState.finalizedCheckpoint.root.valueOf() as Uint8Array;
      const headSlot = headInfo.slot;
      timeSeries.addPoint(headSlot, Date.now());

      const peersRow = `peers: ${connectedPeerCount}`;
      const finalizedCheckpointRow = `finalized: ${prettyBytes(finalizedRoot)}:${finalizedEpoch}`;
      const headRow = `head: ${headInfo.slot} ${prettyBytes(headInfo.blockRoot)}`;
      const isMergeTransitionComplete =
        bellatrix.isBellatrixStateType(headState) && bellatrix.isMergeTransitionComplete(headState);
      const executionInfo = isMergeTransitionComplete
        ? [
            `execution: ${headInfo.executionStatus.toLowerCase()}(${prettyBytes(
              headInfo.executionPayloadBlockHash ?? "empty"
            )})`,
          ]
        : [];

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
  const msFromGenesis = Date.now() - chain.getGenesisTime() * 1000;
  const msToNextSlot = msPerSlot - (msFromGenesis % msPerSlot);
  return msToNextSlot > msPerSlot / 2 ? msToNextSlot - msPerSlot / 2 : msToNextSlot + msPerSlot / 2;
}
