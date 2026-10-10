import {SubnetID, fulu, gloas} from "@lodestar/types";
import * as dataColumnSidecarValidation from "../../validation/dataColumnSidecar.js";
import type {BeaconEngine} from "../beaconEngine.js";
import {GossipValidationResult, runGossipValidation} from "../gossipValidationResult.js";

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/dataColumnSidecar.ts#validateGossipFuluDataColumnSidecar.
 * [beacon-engine] deviation: invoke validation with engine state and convert gossip errors to verdicts.
 */
export function validateGossipFuluDataColumnSidecar(
  this: BeaconEngine,
  _dataColumnBytes: Uint8Array,
  dataColumnSidecar: fulu.DataColumnSidecar,
  gossipSubnet: SubnetID
): Promise<GossipValidationResult<void>> {
  return runGossipValidation(() =>
    dataColumnSidecarValidation.validateGossipFuluDataColumnSidecar.call(
      this,
      dataColumnSidecar,
      gossipSubnet,
      this.metrics
    )
  );
}

/**
 * Validation source: unstable@551b8b0a3d packages/beacon-node/src/chain/validation/dataColumnSidecar.ts#validateGossipGloasDataColumnSidecar.
 * [beacon-engine] deviation: invoke validation with engine state and convert gossip errors to verdicts.
 */
export function validateGossipGloasDataColumnSidecar(
  this: BeaconEngine,
  _dataColumnBytes: Uint8Array,
  dataColumnSidecar: gloas.DataColumnSidecar,
  gossipSubnet: SubnetID
): Promise<GossipValidationResult<void>> {
  return runGossipValidation(() =>
    dataColumnSidecarValidation.validateGossipGloasDataColumnSidecar.call(
      this,
      dataColumnSidecar,
      gossipSubnet,
      this.metrics
    )
  );
}
