import {computeEpochAtSlot} from "@chainsafe/lodestar-beacon-state-transition";
import {prepareEpochProcessState} from "@chainsafe/lodestar-beacon-state-transition/lib/fast";
import {IBlockSummary} from "@chainsafe/lodestar-fork-choice";
import {ILogger} from "@chainsafe/lodestar-utils";
import {BeaconNode} from "../../../src";
import {ChainEvent} from "../../../src/chain";

export function simTestInfoTracker(bn: BeaconNode, logger: ILogger): () => void {
  function onHead(head: IBlockSummary): void {
    // Compute participation (takes 5ms with 64 validators)
    const state = bn.chain.getHeadState();
    const process = prepareEpochProcessState(state);

    const prevParticipation = Number(process.prevEpochUnslashedStake.targetStake) / Number(process.totalActiveStake);
    const currParticipation = Number(process.currEpochUnslashedTargetStake) / Number(process.totalActiveStake);
    logger.info("> Participation", {
      slot: `${head.slot}/${computeEpochAtSlot(bn.config, head.slot)}`,
      prev: prevParticipation,
      curr: currParticipation,
    });
  }

  bn.chain.emitter.on(ChainEvent.forkChoiceHead, onHead);

  return function () {
    bn.chain.emitter.off(ChainEvent.forkChoiceHead, onHead);
  };
}
