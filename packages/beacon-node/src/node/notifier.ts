import {BeaconConfig} from "@lodestar/config";
import {ExecutionStatus, type IForkChoice, PayloadStatus, ProtoBlock} from "@lodestar/fork-choice";
import {EPOCHS_PER_SYNC_COMMITTEE_PERIOD, SLOTS_PER_EPOCH} from "@lodestar/params";
import {computeEpochAtSlot, computeStartSlotAtEpoch} from "@lodestar/state-transition";
import {Epoch} from "@lodestar/types";
import {ErrorAborted, Logger, prettyBytes, prettyBytesShort, sleep} from "@lodestar/utils";
import {IBeaconChain} from "../chain/index.js";
import {ExecutionEngineState} from "../execution/index.js";
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

      if (clockEpoch >= config.BELLATRIX_FORK_EPOCH && computeStartSlotAtEpoch(clockEpoch) === clockSlot) {
        if (chain.executionEngine.state === ExecutionEngineState.OFFLINE) {
          logger.warn("Execution client is offline");
        } else if (chain.executionEngine.state === ExecutionEngineState.AUTH_FAILED) {
          logger.error("Execution client authentication failed. Verify if the JWT secret matches on both clients");
        }
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

      const executionInfo = getHeadExecutionInfo(config, clockEpoch, headInfo, chain.forkChoice);
      const finalizedCheckpointRow = `finalized: ${prettyBytes(finalizedRoot)}:${finalizedEpoch}`;

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
      if (clockEpoch > config.ALTAIR_FORK_EPOCH && clockSlot % SLOTS_PER_SYNC_COMMITTEE_PERIOD === 0) {
        const period = Math.floor(clockEpoch / EPOCHS_PER_SYNC_COMMITTEE_PERIOD);
        logger.info(`New sync committee period ${period}`);
      }

      // Log halfway through each slot
      await sleep(timeToNextHalfSlot(config, chain, isFirstTime), signal);
      isFirstTime = false;
    }
  } catch (e) {
    if (e instanceof ErrorAborted) {
      return; // Ok
    }
    logger.error("Node notifier error", {}, e as Error);
  }
}

function timeToNextHalfSlot(config: BeaconConfig, chain: IBeaconChain, isFirstTime: boolean): number {
  const msPerSlot = config.SLOT_DURATION_MS;
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
  }
  // after the 1st time always wait until middle of next clock slot
  return msToNextSlot + msPerHalfSlot;
}

function getHeadExecutionInfo(
  config: BeaconConfig,
  clockEpoch: Epoch,
  headInfo: ProtoBlock,
  forkChoice: IForkChoice
): string[] {
  if (clockEpoch < config.BELLATRIX_FORK_EPOCH) {
    return [];
  }

  const executionStatusStr = headInfo.executionStatus.toLowerCase();

  if (headInfo.executionStatus === ExecutionStatus.PreMerge) {
    return [`exec-block: ${executionStatusStr}`];
  }

  // Since the notifier fires at mid-slot, the head for the current slot may still be PENDING.
  // In that case, show the previous slot's resolved payload state (the parent block) instead.
  let payloadBlockForDisplay = headInfo;
  let payloadSlotInfo = "";
  if (headInfo.payloadStatus === PayloadStatus.PENDING && headInfo.parentRoot) {
    const parentBlock = forkChoice.getBlockHexDefaultStatus(headInfo.parentRoot);
    if (
      parentBlock &&
      parentBlock.executionStatus !== ExecutionStatus.PreMerge &&
      parentBlock.payloadStatus !== PayloadStatus.PENDING
    ) {
      payloadBlockForDisplay = parentBlock;
      payloadSlotInfo = ` prevSlot:${parentBlock.slot}`;
    }
  }

  const payloadStatusStr =
    payloadBlockForDisplay.payloadStatus === PayloadStatus.PENDING
      ? "pending"
      : payloadBlockForDisplay.payloadStatus === PayloadStatus.EMPTY
        ? "empty"
        : "full";

  const executionPayloadHashInfo = payloadBlockForDisplay.executionPayloadBlockHash;
  const executionPayloadNumberInfo = payloadBlockForDisplay.executionPayloadNumber;
  const bidHashInfo = payloadBlockForDisplay.blockHashFromBid
    ? ` bid:${prettyBytesShort(payloadBlockForDisplay.blockHashFromBid)}`
    : "";

  return [
    `exec-block: ${executionStatusStr}/${payloadStatusStr}(${executionPayloadNumberInfo} ${prettyBytesShort(
      executionPayloadHashInfo
    )}${bidHashInfo}${payloadSlotInfo})`,
  ];
}
