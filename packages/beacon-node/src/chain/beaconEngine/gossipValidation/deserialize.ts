import {Type} from "@chainsafe/ssz";
import {SerializedCache} from "../../../util/serializedCache.js";
import {GossipAction, GossipActionError, GossipErrorCode} from "../../errors/gossipValidation.js";

export function deserializeGossipMessage<T extends object>(
  type: Type<T>,
  bytes: Uint8Array,
  serializedCache?: SerializedCache,
  opts: {reuseBytes: boolean} = {reuseBytes: true}
): T {
  const cached = serializedCache?.getDeserialized<T>(bytes);
  if (cached !== undefined) return cached;
  try {
    return type.deserialize(bytes, opts);
  } catch {
    throw new GossipActionError(GossipAction.REJECT, {code: GossipErrorCode.INVALID_SERIALIZED_BYTES_ERROR_CODE});
  }
}
