import {IBeaconConfig} from "@chainsafe/lodestar-config";
import {ErrorAborted, ILogger, sleep, prettyBytes} from "@chainsafe/lodestar-utils";
import {AbortSignal} from "abort-controller";
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
      const headInfo = chain.forkChoice.getHead();
      const headState = chain.getHeadState();
      const finalizedEpoch = headState.finalizedCheckpoint.epoch;
      const finalizedRoot = headState.finalizedCheckpoint.root;
      const headSlot = headInfo.slot;
      timeSeries.addPoint(headSlot, Date.now());

      const peersRow = `peers: ${connectedPeerCount}`;
      const finalizedCheckpointRow = `finalized: ${finalizedEpoch} ${prettyBytes(finalizedRoot)}`;
      const headRow = `head: ${headInfo.slot} ${prettyBytes(headInfo.blockRoot)}`;
      const clockSlotRow = `clockSlot: ${clockSlot}`;

      let nodeState: string[];
      switch (sync.state) {
        case SyncState.SyncingFinalized:
        case SyncState.SyncingHead: {
          const slotsPerSecond = timeSeries.computeLinearSpeed();
          const distance = Math.max(clockSlot - headSlot, 0);
          const secondsLeft = distance / slotsPerSecond;
          const timeLeft = isFinite(secondsLeft) ? prettyTimeDiff(1000 * secondsLeft) : "?";
          nodeState = [
            "Syncing",
            `${timeLeft} left`,
            `${slotsPerSecond.toPrecision(3)} slots/s`,
            finalizedCheckpointRow,
            headRow,
            clockSlotRow,
            peersRow,
          ];
          break;
        }

        case SyncState.Synced: {
          nodeState = ["Synced", finalizedCheckpointRow, headRow, clockSlotRow, peersRow];
          break;
        }

        case SyncState.Stalled: {
          nodeState = ["Searching for peers", peersRow, finalizedCheckpointRow, headRow, clockSlotRow];
        }
      }
      logger.info(nodeState.join(" - "));

      // Log halfway through each slot
      await sleep(timeToNextHalfSlot(config, chain), signal);
    }
  } catch (e) {
    if (e instanceof ErrorAborted) {
      return; // Ok
    } else {
      logger.error("Node notifier error", {}, e);
    }
  }
}

function timeToNextHalfSlot(config: IBeaconConfig, chain: IBeaconChain): number {
  const msPerSlot = config.params.SECONDS_PER_SLOT * 1000;
  const msFromGenesis = Date.now() - chain.getGenesisTime() * 1000;
  const msToNextSlot = msPerSlot - (msFromGenesis % msPerSlot);
  return msToNextSlot > msPerSlot / 2 ? msToNextSlot - msPerSlot / 2 : msToNextSlot + msPerSlot / 2;
}
