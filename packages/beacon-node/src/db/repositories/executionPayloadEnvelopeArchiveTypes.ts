import {ContainerType, ValueOf} from "@chainsafe/ssz";
import {gloas, ssz} from "@lodestar/types";

const fields = ssz.gloas.ExecutionPayload.fields;
const PayloadMetadata = new ContainerType({
  parentHash: fields.parentHash,
  feeRecipient: fields.feeRecipient,
  stateRoot: fields.stateRoot,
  receiptsRoot: fields.receiptsRoot,
  logsBloom: fields.logsBloom,
  prevRandao: fields.prevRandao,
  blockNumber: fields.blockNumber,
  gasLimit: fields.gasLimit,
  gasUsed: fields.gasUsed,
  timestamp: fields.timestamp,
  extraData: fields.extraData,
  baseFeePerGas: fields.baseFeePerGas,
  blockHash: fields.blockHash,
  blobGasUsed: fields.blobGasUsed,
  excessBlobGas: fields.excessBlobGas,
  slotNumber: fields.slotNumber,
});

export const CompactExecutionPayloadEnvelope = new ContainerType({
  message: new ContainerType({...ssz.gloas.ExecutionPayloadEnvelope.fields, payload: PayloadMetadata}),
  signature: ssz.BLSSignature,
  payloadRoot: ssz.Root,
});

export type CompactExecutionPayloadEnvelope = ValueOf<typeof CompactExecutionPayloadEnvelope>;

export function compactExecutionPayloadEnvelope(
  envelope: gloas.SignedExecutionPayloadEnvelope
): CompactExecutionPayloadEnvelope {
  const {
    transactions: _transactions,
    withdrawals: _withdrawals,
    blockAccessList: _blockAccessList,
    ...payload
  } = envelope.message.payload;
  return {
    message: {...envelope.message, payload},
    signature: envelope.signature,
    payloadRoot: ssz.gloas.ExecutionPayload.hashTreeRoot(envelope.message.payload),
  };
}
