import {PeerId} from "@libp2p/interface-peer-id";
import {createKeypairFromPeerId, ENR, ENRKey, ENRValue} from "@chainsafe/discv5";
import {writeFile600Perm, readFile} from "../util/index.js";

/**
 * `FileENR` is an `ENR` that saves the ENR contents to a file on every modification
 */
export class FileENR extends ENR {
  private filename: string;
  private localPeerId: PeerId;

  constructor(
    filename: string,
    peerId: PeerId,
    kvs: Record<string, Uint8Array> | undefined,
    seq: bigint,
    signature: Buffer | null
  ) {
    super(kvs, seq, signature);
    Object.setPrototypeOf(this, FileENR.prototype);
    this.filename = filename;
    this.localPeerId = peerId;
    return this;
  }

  static initFromFile(filename: string, peerId: PeerId): FileENR {
    const enr = FileENR.decodeTxt(readFile(filename)) as FileENR;
    return this.initFromENR(filename, peerId, enr);
  }
  static initFromENR(filename: string, peerId: PeerId, enr: ENR): FileENR {
    const kvs = Array.from(enr.entries()).reduce((obj: Record<ENRKey, ENRValue>, kv) => {
      obj[kv[0]] = kv[1];
      return obj;
    }, {});
    return new FileENR(filename, peerId, kvs, enr.seq, enr.signature);
  }

  saveToFile(): void {
    if (this.localPeerId === null || this.localPeerId === undefined) return;
    const keypair = createKeypairFromPeerId(this.localPeerId);
    writeFile600Perm(this.filename, this.encodeTxt(keypair.privateKey));
  }

  set(key: ENRKey, value: ENRValue): this {
    super.set(key, value);
    this.saveToFile();
    return this;
  }

  delete(key: ENRKey): boolean {
    const result = super.delete(key);
    this.saveToFile();
    return result;
  }
}
