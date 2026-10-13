import {SubnetID, ssz} from "@lodestar/types";
import {GossipActionError} from "../../errors/gossipValidation.js";
import * as dataColumnSidecarValidation from "../../validation/dataColumnSidecar.js";
import type {BeaconEngine} from "../beaconEngine.js";
import {GossipValidationResult, fromResult, ignore, runGossipValidation} from "../gossipValidationResult.js";
import {deserializeGossipMessage} from "./deserialize.js";

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/dataColumnSidecar.ts#validateGossipFuluDataColumnSidecar.
 * [beacon-engine] deviation: invoke validation with engine state and convert gossip errors to verdicts.
 */
export async function validateGossipFuluDataColumnSidecar(
  this: BeaconEngine,
  dataColumnBytes: Uint8Array,
  gossipSubnet: SubnetID
): Promise<GossipValidationResult<void>> {
  try {
    const dataColumnSidecar = deserializeGossipMessage(
      ssz.fulu.DataColumnSidecar,
      dataColumnBytes,
      this.serializedCache
    );
    return await runGossipValidation(() =>
      dataColumnSidecarValidation.validateGossipFuluDataColumnSidecar.call(
        this,
        dataColumnSidecar,
        gossipSubnet,
        this.metrics
      )
    );
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error("Error validating gossip fulu data column sidecar", {code: "UNEXPECTED_ERROR"}, error as Error);
    return ignore("UNEXPECTED_ERROR");
  }
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/dataColumnSidecar.ts#validateGossipGloasDataColumnSidecar.
 * [beacon-engine] deviation: invoke validation with engine state and convert gossip errors to verdicts.
 */
export async function validateGossipGloasDataColumnSidecar(
  this: BeaconEngine,
  dataColumnBytes: Uint8Array,
  gossipSubnet: SubnetID
): Promise<GossipValidationResult<void>> {
  try {
    const dataColumnSidecar = deserializeGossipMessage(
      ssz.gloas.DataColumnSidecar,
      dataColumnBytes,
      this.serializedCache
    );
    return await runGossipValidation(() =>
      dataColumnSidecarValidation.validateGossipGloasDataColumnSidecar.call(
        this,
        dataColumnSidecar,
        gossipSubnet,
        this.metrics
      )
    );
  } catch (error) {
    if (error instanceof GossipActionError) return fromResult({err: error});
    this.logger.error("Error validating gossip gloas data column sidecar", {code: "UNEXPECTED_ERROR"}, error as Error);
    return ignore("UNEXPECTED_ERROR");
  }
}
