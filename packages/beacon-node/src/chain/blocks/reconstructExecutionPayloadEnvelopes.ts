import {ForkName} from "@lodestar/params";
import {gloas, ssz} from "@lodestar/types";
import {byteArrayEquals, toRootHex} from "@lodestar/utils";
import {CompactExecutionPayloadEnvelope} from "../../db/repositories/executionPayloadEnvelopeArchiveTypes.js";
import {IExecutionEngine} from "../../execution/engine/interface.js";
import {PayloadReconstructionError, PayloadReconstructionErrorCode} from "../errors/payloadReconstruction.js";

export const PAYLOAD_BODY_BATCH_SIZE = 32;

export async function reconstructExecutionPayloadEnvelopes(
  engine: Pick<IExecutionEngine, "getPayloadBodiesByRange">,
  envelopes: CompactExecutionPayloadEnvelope[]
): Promise<gloas.SignedExecutionPayloadEnvelope[]> {
  const result: gloas.SignedExecutionPayloadEnvelope[] = [];
  for (let i = 0; i < envelopes.length; ) {
    const first = envelopes[i];
    const start = first.message.payload.blockNumber;
    const batch = [first];
    let count = 1;
    while (i + count < envelopes.length && count < PAYLOAD_BODY_BATCH_SIZE) {
      const next = envelopes[i + count];
      if (next.message.payload.blockNumber !== start + count) break;
      batch.push(next);
      count++;
    }

    // These records belong to finalized execution ancestry, so block-number lookups are stable.
    const bodies = await engine.getPayloadBodiesByRange(ForkName.gloas, start, count);
    if (bodies.length > count) {
      throw new PayloadReconstructionError({
        code: PayloadReconstructionErrorCode.INVALID_RESPONSE,
        slot: first.message.payload.slotNumber,
        blockHash: toRootHex(first.message.payload.blockHash),
      });
    }
    for (let j = 0; j < count; j++) {
      const envelope = batch[j];
      const {payload: metadata} = envelope.message;
      const body = bodies[j];
      const context = {slot: metadata.slotNumber, blockHash: toRootHex(metadata.blockHash)};
      if (body == null || body.withdrawals == null || body.blockAccessList == null) {
        throw new PayloadReconstructionError({code: PayloadReconstructionErrorCode.BODY_UNAVAILABLE, ...context});
      }
      const payload: gloas.ExecutionPayload = {
        ...metadata,
        transactions: body.transactions,
        withdrawals: body.withdrawals,
        blockAccessList: body.blockAccessList,
      };
      if (!byteArrayEquals(ssz.gloas.ExecutionPayload.hashTreeRoot(payload), envelope.payloadRoot)) {
        throw new PayloadReconstructionError({code: PayloadReconstructionErrorCode.PAYLOAD_ROOT_MISMATCH, ...context});
      }
      result.push({message: {...envelope.message, payload}, signature: envelope.signature});
    }
    i += count;
  }
  return result;
}

export async function* reconstructExecutionPayloadEnvelopeStream(
  engine: Pick<IExecutionEngine, "getPayloadBodiesByRange">,
  envelopes: AsyncIterable<CompactExecutionPayloadEnvelope>
): AsyncIterable<gloas.SignedExecutionPayloadEnvelope> {
  let batch: CompactExecutionPayloadEnvelope[] = [];
  for await (const envelope of envelopes) {
    batch.push(envelope);
    if (batch.length === PAYLOAD_BODY_BATCH_SIZE) {
      yield* await reconstructExecutionPayloadEnvelopes(engine, batch);
      batch = [];
    }
  }
  if (batch.length > 0) yield* await reconstructExecutionPayloadEnvelopes(engine, batch);
}
