import {toHexString} from "@chainsafe/ssz";
import {ServerApi, routes} from "@lodestar/api";
import {BLSSignature, ProducedBlockSource, Slot, allForks, bellatrix} from "@lodestar/types";
import {isForkBlobs, isForkExecution} from "@lodestar/params";
import {toHex} from "@lodestar/utils";
import {ApiModules} from "../../types.js";
import {toGraffitiBuffer} from "../../../../util/graffiti.js";
import {ValidatorEndpointDependencies} from "./types.js";

export function buildProduceBlockV2(
  {metrics, chain, config, logger}: ApiModules,
  {notWhileSyncing, waitForSlotWithDisparity}: ValidatorEndpointDependencies
): ServerApi<routes.validator.Api>["produceBlockV2"] {
  return async function produceBlockV2(
    slot: Slot,
    randaoReveal: BLSSignature,
    graffiti: string,
    {
      feeRecipient,
      strictFeeRecipientCheck,
      skipHeadChecksAndUpdate,
    }: Omit<routes.validator.ExtraProduceBlockOps, "builderSelection"> & {skipHeadChecksAndUpdate?: boolean} = {}
  ): Promise<routes.validator.ProduceBlockOrContentsRes> {
    const source = ProducedBlockSource.engine;
    metrics?.blockProductionRequests.inc({source});

    if (skipHeadChecksAndUpdate !== true) {
      notWhileSyncing();
      await waitForSlotWithDisparity(slot); // Must never request for a future slot > currentSlot

      // Process the queued attestations in the forkchoice for correct head estimation
      // forkChoice.updateTime() might have already been called by the onSlot clock
      // handler, in which case this should just return.
      chain.forkChoice.updateTime(slot);
      chain.recomputeForkChoiceHead();
    }

    let timer;
    try {
      timer = metrics?.blockProductionTime.startTimer();
      const {block, executionPayloadValue, consensusBlockValue} = await chain.produceBlock({
        slot,
        randaoReveal,
        graffiti: toGraffitiBuffer(graffiti || ""),
        feeRecipient,
      });
      const version = config.getForkName(block.slot);
      if (strictFeeRecipientCheck && feeRecipient && isForkExecution(version)) {
        const blockFeeRecipient = toHexString((block as bellatrix.BeaconBlock).body.executionPayload.feeRecipient);
        if (blockFeeRecipient !== feeRecipient) {
          throw Error(`Invalid feeRecipient set in engine block expected=${feeRecipient} actual=${blockFeeRecipient}`);
        }
      }

      metrics?.blockProductionSuccess.inc({source});
      metrics?.blockProductionNumAggregated.observe({source}, block.body.attestations.length);
      logger.verbose("Produced execution block", {
        slot,
        executionPayloadValue,
        consensusBlockValue,
        root: toHexString(config.getForkTypes(slot).BeaconBlock.hashTreeRoot(block)),
      });
      if (chain.opts.persistProducedBlocks) {
        void chain.persistBlock(block, "produced_engine_block");
      }
      if (isForkBlobs(version)) {
        const blockHash = toHex((block as bellatrix.BeaconBlock).body.executionPayload.blockHash);
        const contents = chain.producedContentsCache.get(blockHash);
        if (contents === undefined) {
          throw Error("contents missing in cache");
        }

        return {
          data: {block, ...contents} as allForks.BlockContents,
          version,
          executionPayloadValue,
          consensusBlockValue,
        };
      } else {
        return {data: block, version, executionPayloadValue, consensusBlockValue};
      }
    } finally {
      if (timer) timer({source});
    }
  };
}
