/* eslint-disable @typescript-eslint/no-require-imports,@typescript-eslint/no-var-requires */

import {BenchSuite} from "@chainsafe/benchmark-utils";
import {verify} from "../../../src";


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

export function verifyValidSignatureBenchmark(dir: string): BenchSuite {

  // Set the function test
  const FUNCTION_NAME = "verifyValidSignature"; // PLEASE FILL THIS OUT

  const verifyValidSignature = function (): void {
    global.verify(global.publicKey, global.message, global.signature, global.domain);
  };

  return {
    testFunctions: [verifyValidSignature],
    setup: function() {
      const {Keypair} = require("../../../src");
      const {sha256} = require('js-sha256');
      const keypair = Keypair.generate();
      global.publicKey = keypair.publicKey.toBytesCompressed();
      global.message = Buffer.from(sha256.arrayBuffer(Math.random().toString(36)));
      global.signature = keypair.privateKey.signMessage(Buffer.from(global.message), global.domain).toBytesCompressed();
    },
    file: dir + FUNCTION_NAME + ".txt"
  };
}