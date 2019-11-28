/* eslint-disable @typescript-eslint/no-require-imports,@typescript-eslint/no-var-requires */

import {BenchSuite} from "@chainsafe/benchmark-utils";
import {verify} from "../../../src";
import {sha256} from "js-sha256";


// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace global {
  export let domain: Buffer;
  export let message: Buffer;
  export let signature: Buffer;
  export let publicKey: Buffer;
  export let verify: Function;
}

// @ts-ignore
global.require = require;

global.domain = Buffer.alloc(8);
global.verify = verify;

global.message = Buffer.from(sha256.arrayBuffer(Math.random().toString(36)));



export function verifyValidSignatureBenchmark(dir: string): BenchSuite {

  // Set the function test
  const FUNCTION_NAME = "verifyValidSignature"; // PLEASE FILL THIS OUT

  const verifyValidSignature = function (): void {
    global.verify(global.publicKey, global.message, global.signature, global.domain);
  };

  return {
    name: FUNCTION_NAME,
    testFunctions: [verifyValidSignature],
    setup: function() {
      let i = 0;
      const {Keypair, PrivateKey} = require("../../../src");
      const keypair = new Keypair(PrivateKey.fromInt(i));
      i = i+1;
      global.publicKey = keypair.publicKey.toBytesCompressed();
      global.signature = keypair.privateKey.signMessage(Buffer.from(global.message), global.domain).toBytesCompressed();
    },
    file: dir + FUNCTION_NAME + ".txt"
  };
}