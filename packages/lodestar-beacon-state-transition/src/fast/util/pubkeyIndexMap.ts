import {ByteVector, toHexString} from "@chainsafe/ssz";
import {ValidatorIndex} from "@chainsafe/lodestar-types";

export class PubkeyIndexMap extends Map<ByteVector, ValidatorIndex> implements IPubkeyIndexGetter {
  get(key: ByteVector): ValidatorIndex | undefined {
    return super.get(toHexString(key) as unknown as ByteVector);
  }
  set(key: ByteVector, value: ValidatorIndex): this {
    return super.set(toHexString(key) as unknown as ByteVector, value);
  }
}

export interface IPubkeyIndexGetter {
  get(key: ByteVector): ValidatorIndex | undefined;
}

export const pubkey2indexProxyHandler = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  get: (target: PubkeyIndexMap, p: string | number | symbol): any => {
    if (p !== "get") {
      throw new Error(`Illegal access '${p.toString()}' from pubkey2index`);
    }
    return target.get.bind(target);
  }
};