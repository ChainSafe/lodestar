/* eslint-disable @typescript-eslint/no-require-imports,@typescript-eslint/no-var-requires */

import {BenchSuite} from "@chainsafe/benchmark-utils";
import {aggregateSignatures} from "../../../src";


// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace global {
  export let signatures: Buffer[];
  export let aggregateSignatures: Function;
}

// @ts-ignore
global.require = require;

global.aggregateSignatures = aggregateSignatures;

export function aggregateSignaturesBenchmark(dir: string): BenchSuite {

  // Set the function test
  const FUNCTION_NAME = "verifyValidSignature"; // PLEASE FILL THIS OUT

  const aggregateSignatures = function (): void {
    global.aggregateSignatures(global.signatures);
  };

  return {
    testFunctions: [aggregateSignatures],
    setup: function() {
      global.signatures = [];
      const {Keypair} = require("../../../src");
      const {sha256} = require('js-sha256');
      const keypair = Keypair.generate();
      const message = Buffer.from(sha256.arrayBuffer(Math.random().toString(36)));
      global.signatures.push(keypair.privateKey.signMessage(Buffer.from(message), Buffer.alloc(8)).toBytesCompressed());
    },
    file: dir + FUNCTION_NAME + ".txt"
  };
}