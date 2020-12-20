import {RequestBody, ResponseBody} from "@chainsafe/lodestar-types";
import {CompositeType} from "@chainsafe/ssz";
import {Method, Methods, ReqRespEncoding} from "../../constants";
import {BufferedSource} from "./bufferedSource";
import {readSszSnappyChunk} from "./sszSnappy";

export type Direction = "response" | "request";
export type RequestOrResponseType = Exclude<
  ReturnType<typeof Methods[Method]["responseSSZType"]> | ReturnType<typeof Methods[Method]["requestSSZType"]>,
  null
>;

interface IOptions {
  isSszTree?: boolean;
}

export async function readChunk<T extends ResponseBody | RequestBody>(
  bufferedSource: BufferedSource,
  encoding: ReqRespEncoding,
  type: RequestOrResponseType,
  options?: IOptions
): Promise<T> {
  const bodyBytes = await readChunkAndDecode(bufferedSource, encoding, type);
  return deserializeBody<T>(bodyBytes, type, options);
}

async function readChunkAndDecode(
  bufferedSource: BufferedSource,
  encoding: ReqRespEncoding,
  type: RequestOrResponseType
): Promise<Buffer> {
  switch (encoding) {
    case ReqRespEncoding.SSZ_SNAPPY: {
      const minSize = type.minSize();
      const maxSize = type.maxSize();
      return await readSszSnappyChunk(bufferedSource, {minSize, maxSize});
    }

    default:
      throw Error("Unsupported encoding");
  }
}

function deserializeBody<T extends ResponseBody | RequestBody>(
  bytes: Buffer,
  type: RequestOrResponseType,
  options?: IOptions
): T {
  if (options?.isSszTree) {
    return (((type as unknown) as CompositeType<Record<string, unknown>>).tree.deserialize(bytes) as unknown) as T;
  } else {
    return type.deserialize(bytes) as T;
  }
}
