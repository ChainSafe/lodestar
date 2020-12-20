import varint from "varint";
import {source} from "stream-to-it";
import {createCompressStream} from "@chainsafe/snappy-stream";
import {RequestOrResponseBody, RequestOrResponseType} from "../../interface";
import {SszSnappyError, SszSnappyErrorCode} from "./errors";

export async function* writeChunkSszSnappy<T extends RequestOrResponseBody>(
  body: T,
  type: RequestOrResponseType
): AsyncGenerator<Buffer> {
  const bytes = serializeBody(body, type);

  yield Buffer.from(varint.encode(bytes.length));

  yield* encodeSszSnappy(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length));
}

export function encodeSszSnappy(bytes: Buffer): AsyncGenerator<Buffer> {
  const stream = createCompressStream();
  stream.write(bytes);
  stream.end();
  return source<Buffer>(stream);
}

function serializeBody<T extends RequestOrResponseBody>(body: T, type: RequestOrResponseType): Uint8Array {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return type.serialize(body as any);
  } catch (e) {
    throw new SszSnappyError({code: SszSnappyErrorCode.SERIALIZE_ERROR, serializeError: e});
  }
}
