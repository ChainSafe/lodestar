import {createKeypairFromPeerId, ENR, ENRKey, ENRValue} from "@chainsafe/discv5";
import {writeFileSync, readFileSync} from "fs";
import PeerId from "peer-id";

/**
 * `FileENR` is an `ENR` that saves the ENR contents to a file on every modification
 */
export class FileENR extends ENR {
  private filename: string;
  private localPeerId: PeerId;

  constructor(filename: string, peerId: PeerId) {
    super();
    this.filename = filename;
    this.localPeerId = peerId;
  }

  static initFromFile(filename: string, peerId: PeerId): FileENR {
    const enr = FileENR.decodeTxt(readFileSync(filename, "utf8")) as FileENR;
    return this.initFromENR(filename, peerId, enr);
  }

  static initFromENR(filename: string, peerId: PeerId, enr: FileENR): FileENR {
    Object.setPrototypeOf(enr, FileENR.prototype);
    enr.filename = filename;
    enr.localPeerId = peerId;
    return enr;
  }

  saveToFile(): void {
    const keypair = createKeypairFromPeerId(this.localPeerId);
    writeFileSync(this.filename, this.encodeTxt(keypair.privateKey));
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
