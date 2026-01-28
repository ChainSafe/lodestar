import {encode as varintEncode} from "uint8-varint";
import {Uint8ArrayList} from "uint8arraylist";
import {encodeSnappyFrames} from "../../utils/snappyIndex.js";

/**
 * Encodes SSZ data with snappy framing.
 * Wire format:
 * ```
 * <varint-length> | <snappy-frames(ssz-payload)>
 * ```
 * Returns Uint8ArrayList ready for writing to stream.
 */
export function encodeSszSnappyPayload(sszData: Uint8Array): Uint8ArrayList {
  const result = new Uint8ArrayList();

  // MUST encode the length of the raw SSZ bytes, encoded as an unsigned protobuf varint
  const varint = varintEncode(sszData.length);
  result.append(new Uint8Array(varint.buffer, varint.byteOffset, varint.byteLength));

  // Encode SSZ data with snappy frames
  const snappyFrames = encodeSnappyFrames(sszData);
  result.append(snappyFrames);

  return result;
}
