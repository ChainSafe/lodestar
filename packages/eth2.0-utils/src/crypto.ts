import {bytes} from "@chainsafe/eth2.0-types";
// @ts-ignore
import sha256, {init, update, digest} from "@chainsafe/as-sha256";

export function hash(data: bytes): bytes {
  return Buffer.from(sha256(data));
}

export class Hash {
  public constructor() {
    init();
  }

  public update(data: bytes): void {
    update(data, data.length);
  }

  public finish(): bytes {
    return Buffer.from(digest());
  }
}