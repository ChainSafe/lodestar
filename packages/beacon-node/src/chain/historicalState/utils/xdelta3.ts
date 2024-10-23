import {encodeSync, decodeSync} from "@chainsafe/xdelta3-node";
import {IStateDiffCodec} from "../types.js";

export class XDelta3Codec implements IStateDiffCodec {
  compute(base: Uint8Array, changed: Uint8Array): Uint8Array {
    try {
      return encodeSync(base, changed);
    } catch (err) {
      throw new Error(`Can not compute binary diff error=${(err as Error).message}`);
    }
  }

  apply(base: Uint8Array, delta: Uint8Array): Uint8Array {
    try {
      return decodeSync(base, delta);
    } catch (err) {
      throw new Error(`Can not apply binary diff patch error=${(err as Error).message}`);
    }
  }
}
