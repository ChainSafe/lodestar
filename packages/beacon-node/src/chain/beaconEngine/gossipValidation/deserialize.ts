import {Type} from "@chainsafe/ssz";
import {GossipAction, GossipActionError, GossipErrorCode} from "../../errors/gossipValidation.js";

export function deserializeGossipMessage<T extends object>(
  type: Type<T>,
  bytes: Uint8Array,
  opts: {reuseBytes: boolean} = {reuseBytes: true}
): T {
  try {
    return type.deserialize(bytes, opts);
  } catch {
    throw new GossipActionError(GossipAction.REJECT, {code: GossipErrorCode.INVALID_SERIALIZED_BYTES_ERROR_CODE});
  }
}
