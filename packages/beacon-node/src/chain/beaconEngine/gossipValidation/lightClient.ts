import {ForkName, ForkPostAltair} from "@lodestar/params";
import {sszTypesFor} from "@lodestar/types";
import {GossipActionError} from "../../errors/gossipValidation.js";
import {validateLightClientFinalityUpdate} from "../../validation/lightClientFinalityUpdate.js";
import {validateLightClientOptimisticUpdate} from "../../validation/lightClientOptimisticUpdate.js";
import type {BeaconEngine} from "../beaconEngine.js";
import {GossipValidationResult, accept, fromResult, ignore} from "../gossipValidationResult.js";
import {deserializeGossipMessage} from "./deserialize.js";

export async function validateGossipLightClientOptimisticUpdate(
  this: BeaconEngine,
  bytes: Uint8Array,
  fork: ForkName
): Promise<GossipValidationResult<void>> {
  try {
    const update = deserializeGossipMessage(
      sszTypesFor(fork as ForkPostAltair, "LightClientOptimisticUpdate"),
      bytes,
      this.serializedCache
    );
    validateLightClientOptimisticUpdate(
      this.config,
      this.clock,
      this.getLightClientServer().getOptimisticUpdate(),
      update
    );
    return accept(undefined);
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error(
      "Error validating gossip light client optimistic update",
      {code: "UNEXPECTED_ERROR"},
      error as Error
    );
    return ignore("UNEXPECTED_ERROR");
  }
}

export async function validateGossipLightClientFinalityUpdate(
  this: BeaconEngine,
  bytes: Uint8Array,
  fork: ForkName
): Promise<GossipValidationResult<void>> {
  try {
    const update = deserializeGossipMessage(
      sszTypesFor(fork as ForkPostAltair, "LightClientFinalityUpdate"),
      bytes,
      this.serializedCache
    );
    validateLightClientFinalityUpdate(this.config, this.clock, this.getLightClientServer().getFinalityUpdate(), update);
    return accept(undefined);
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error(
      "Error validating gossip light client finality update",
      {code: "UNEXPECTED_ERROR"},
      error as Error
    );
    return ignore("UNEXPECTED_ERROR");
  }
}
