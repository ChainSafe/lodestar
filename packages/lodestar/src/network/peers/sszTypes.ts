import {BasicType} from "@chainsafe/ssz";

export class StringType extends BasicType<string> {
  serialize(value: string): Uint8Array {
    return Buffer.from(value);
  }

  deserialize(data: Uint8Array): string {
    return Buffer.from(data).toString();
  }
}
