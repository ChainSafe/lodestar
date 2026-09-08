import {Type} from "@chainsafe/ssz";
import {
  ForkName,
  MAX_ATTESTATIONS,
  MAX_ATTESTATIONS_ELECTRA,
  MAX_ATTESTER_SLASHINGS,
  MAX_ATTESTER_SLASHINGS_ELECTRA,
  isForkPostElectra,
} from "@lodestar/params";
import {SignedBeaconBlock, fulu} from "@lodestar/types";
import {ServingCapacityError, ServingConfigurationError, ServingContext} from "./context.js";

export function serializeServingValue<T>(
  type: Type<T>,
  value: T,
  context: ServingContext,
  maxBytes: number
): Uint8Array {
  context.assertActive();
  const size = type.value_serializedSize(value);
  if (!Number.isSafeInteger(size) || size < type.minSize || size > Math.min(maxBytes, context.limits.sourceBytes)) {
    throw new ServingCapacityError("serialized bytes");
  }
  const bytes = new Uint8Array(size);
  const end = type.value_serializeToBytes({uint8Array: bytes, dataView: new DataView(bytes.buffer)}, 0, value);
  if (end !== size) throw new ServingConfigurationError("SSZ size invariant");
  return context.checkBacking(bytes);
}

export function preflightServingBlock(block: SignedBeaconBlock, fork: ForkName, context: ServingContext): void {
  if (fork === ForkName.gloas) throw new ServingConfigurationError("Unsupported serving fork gloas");
  const body = block.message.body;
  if (
    body.attestations.length > (isForkPostElectra(fork) ? MAX_ATTESTATIONS_ELECTRA : MAX_ATTESTATIONS) ||
    body.attesterSlashings.length >
      (isForkPostElectra(fork) ? MAX_ATTESTER_SLASHINGS_ELECTRA : MAX_ATTESTER_SLASHINGS) ||
    ("executionPayload" in body && body.executionPayload.transactions.length > context.limits.transactionVisits)
  ) {
    throw new ServingCapacityError("block size visits");
  }
}

export function preflightServingColumn(column: fulu.DataColumnSidecar, maxBlobs: number): void {
  if (
    column.column.length > maxBlobs ||
    column.column.length !== column.kzgCommitments.length ||
    column.column.length !== column.kzgProofs.length
  )
    throw new ServingCapacityError("column list work");
}
