import {FAR_FUTURE_EPOCH} from "@chainsafe/lodestar-params";
import {allForks, ValidatorIndex} from "@chainsafe/lodestar-types";

import {computeActivationExitEpoch, getChurnLimit} from "../../util";
import {BlockProcess} from "../../util/blockProcess";
import {CachedBeaconState} from "../util";

/**
 * Initiate the exit of the validator with index ``index``.
 */
export function initiateValidatorExit(
  state: CachedBeaconState<allForks.BeaconState>,
  index: ValidatorIndex,
  blockProcess: BlockProcess
): void {
  const {config, validators, epochCtx} = state;
  // return if validator already initiated exit
  if (validators[index].exitEpoch !== FAR_FUTURE_EPOCH) {
    return;
  }

  // the 1st time we process validator exit in this block
  if (blockProcess.validatorExitCache === undefined) {
    const currentEpoch = epochCtx.currentShuffling.epoch;

    // compute exit queue epoch
    const validatorArr = validators.persistent.toArray();
    const exitEpochs = [];

    let exitQueueEpoch = computeActivationExitEpoch(currentEpoch);
    exitEpochs.push(exitQueueEpoch);

    let exitQueueChurn = 0;
    for (let i = 0; i < validatorArr.length; i++) {
      const {exitEpoch} = validatorArr[i];
      if (exitEpoch !== FAR_FUTURE_EPOCH) {
        exitEpochs.push(exitEpoch);
        if (exitEpoch === exitQueueEpoch) {
          exitQueueChurn++;
        } else if (exitEpoch > exitQueueEpoch) {
          exitQueueEpoch = exitEpoch;
          exitQueueChurn = 0;
        }
      }
    }

    const churnLimit = getChurnLimit(config, epochCtx.currentShuffling.activeIndices.length);
    if (exitQueueChurn >= churnLimit) {
      // 1st validator with this exitQueueEpoch
      exitQueueEpoch += 1;
      exitQueueChurn = 1;
    }

    blockProcess.validatorExitCache = {
      exitQueueEpoch,
      exitQueueChurn,
      churnLimit,
    };
  } else {
    blockProcess.validatorExitCache.exitQueueChurn++;
    if (blockProcess.validatorExitCache.exitQueueChurn >= blockProcess.validatorExitCache.churnLimit) {
      // 1st validator with this exitQueueEpoch
      blockProcess.validatorExitCache.exitQueueEpoch += 1;
      blockProcess.validatorExitCache.exitQueueChurn = 0;
    }
  }

  // set validator exit epoch and withdrawable epoch
  const {exitQueueEpoch} = blockProcess.validatorExitCache;
  validators.update(index, {
    exitEpoch: exitQueueEpoch,
    withdrawableEpoch: exitQueueEpoch + config.MIN_VALIDATOR_WITHDRAWABILITY_DELAY,
  });
}
