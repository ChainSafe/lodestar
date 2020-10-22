import {ENR, ENRKey, ENRValue} from "@chainsafe/discv5";
import {writeFileSync} from "fs";
import {readFileSync} from "../../util";

export class FileENR extends ENR {
  private filename: string;

  constructor(filename: string) {
    super();
    // this.initFromFile(filename);
    // console.log('filename: ', filename);
    // console.log('peerId: ', peerId);
    // const kvs: Record<ENRKey, ENRValue> = {};
    // for (const [k, v] of enr.entries()) {
    //   kvs[k] = v;
    // }
    // console.log('enr: ', enr);
    // console.log('kvs: ', kvs);
    // super(kvs);
    // // super();
    // // super(kvs, enr.seq, enr.signature);
    // // super({}, enr.seq, enr.signature);
    // // super(undefined, enr.seq, enr.signature);
    this.filename = filename;
    // this.signature = enr.signature;
    // this.seq = enr.seq;
  }

  static initFromFile(filename: string): FileENR {
    const enr = FileENR.decodeTxt(readFileSync(filename)) as FileENR;
    // Object.setPrototypeOf(enr, FileENR);
    // enr.__proto__ = FileENR;
    Object.setPrototypeOf(enr, this);
    // this.filename = filename;
    enr.filename = filename;
    return enr;
  }

  set(key: ENRKey, value: ENRValue): this {
    // writeEnr(this.filename, this, this.localPeerId);
    super.set(key, value);
    console.log("this: ", this);
    console.log("this.filename", this.filename);
    console.log("this.port: ", this.get("port"));
    // if (this.get('id')) writeFile(this.filename, this.encodeTxt(), () => {});
    writeFileSync(this.filename, this.encodeTxt(this.keypair.privateKey));
    // return super.set(key, value);
    return this;
  }
}
