import {ENR, ENRKey, ENRValue} from "@chainsafe/discv5";
import {writeFileSync} from "fs";
import {readFileSync} from "../../util";

export class FileENR extends ENR {
  private filename: string;

  constructor(filename: string) {
    const enr = ENR.decodeTxt(readFileSync(filename));
    const kvs: Record<ENRKey, ENRValue> = {};
    for (const [k, v] of enr.entries()) {
      kvs[k] = v;
    }
    super(kvs, enr.seq, enr.signature);
    // super();
    this.filename = filename;
  }
  set(key: ENRKey, value: ENRValue): this {
    const enr = super.set(key, value);
    writeFileSync(enr.filename, enr.encodeTxt(enr.keypair.privateKey || undefined));
    // writeFileSync(this.filename, this.encodeTxt());
    return enr;
  }
}
