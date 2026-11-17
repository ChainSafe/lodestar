import {heze, ssz} from "@lodestar/types";
import {callInNextEventLoop} from "../../../util/eventLoop.js";
import {GossipActionError} from "../../errors/gossipValidation.js";
import * as inclusionListValidation from "../../validation/inclusionList.js";
import type {BeaconEngineCore} from "../beaconEngineCore.js";
import {GossipValidationResult, fromResult, ignore, runGossipValidation} from "../gossipValidationResult.js";
import {deserializeGossipMessage} from "./deserialize.js";

export async function validateGossipInclusionListBytes(
  this: BeaconEngineCore,
  listBytes: Uint8Array,
  seenTimestampSec: number
): Promise<GossipValidationResult<{totalBytes: number}>> {
  try {
    const list = deserializeGossipMessage(ssz.heze.SignedInclusionList, listBytes);
    return await validateGossipInclusionList.call(this, list, seenTimestampSec);
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error("Error validating gossip inclusion list", {code: "UNEXPECTED_ERROR"}, error as Error);
    return ignore("UNEXPECTED_ERROR");
  }
}

export async function validateGossipInclusionList(
  this: BeaconEngineCore,
  list: heze.SignedInclusionList,
  seenTimestampSec: number
): Promise<GossipValidationResult<{totalBytes: number}>> {
  try {
    return await runGossipValidation(async () => {
      const {committeeIndices, totalBytes} = await inclusionListValidation.validateGossipInclusionList.call(this, list);
      callInNextEventLoop(() => {
        const slot = list.message.slot;
        try {
          const secFromSlot = this.clock.secFromSlot(slot, seenTimestampSec);
          const isTimely =
            secFromSlot >= 0 && secFromSlot * 1000 < this.config.getInclusionListDueMs(this.config.getForkName(slot));
          const insertOutcome = this.inclusionListStore.process(list, committeeIndices, isTimely);
          this.metrics?.inclusionListStore.insertOutcome.inc({insertOutcome});
          this.metrics?.inclusionListStore.size.set(this.inclusionListStore.size);
        } catch (e) {
          this.logger.debug("Error handling gossip inclusion list", {slot}, e as Error);
        }
      });
      return {totalBytes};
    });
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error("Error validating gossip inclusion list", {code: "UNEXPECTED_ERROR"}, error as Error);
    return ignore("UNEXPECTED_ERROR");
  }
}
