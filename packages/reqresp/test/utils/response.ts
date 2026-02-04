import {Uint8ArrayList} from "uint8arraylist";
import {encodeErrorResponse, encodeResponseChunk} from "../../src/encoders/responseEncode.js";
import {RespStatus} from "../../src/interface.js";
import {Protocol} from "../../src/types.js";
import {ResponseChunk} from "../fixtures/encoders.js";
import {beaconConfig} from "../fixtures/messages.js";

/**
 * Encodes response chunks for testing.
 * Returns array of Uint8ArrayList chunks.
 */
export function responseEncode(responseChunks: ResponseChunk[], protocol: Protocol): Uint8ArrayList[] {
  const result: Uint8ArrayList[] = [];

  for (const chunk of responseChunks) {
    if (chunk.status === RespStatus.SUCCESS) {
      const payload = chunk.payload;
      const boundary = beaconConfig.getForkBoundaryAtEpoch(beaconConfig.forks[payload.fork].epoch);
      result.push(encodeResponseChunk(protocol, {...payload, boundary}));
    } else {
      result.push(encodeErrorResponse(protocol, chunk.status, chunk.errorMessage));
    }
  }

  return result;
}
