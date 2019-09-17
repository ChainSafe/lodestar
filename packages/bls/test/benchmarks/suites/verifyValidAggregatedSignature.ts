import {BenchSuite} from "@chainsafe/benchmark-utils";
import {aggregateSignatures, Keypair, verifyMultiple} from "../../../src";


// eslint-disable-next-line @typescript-eslint/no-namespace
declare namespace global {
  export let domain: Buffer;
  export let messages: Buffer[];
  export let signature: Buffer;
  export let publicKeys: Buffer[];
  export let keypairs: Keypair[];
  export let verify: Function;
}

// @ts-ignore
global.require = require;

global.domain = Buffer.alloc(8);
global.verify = verifyMultiple;

export function verifyValidAggregatedSignature(dir: string): BenchSuite {

  global.publicKeys = [];
  global.keypairs = [];
  for(let i = 0; i < 128; i++) {
    const keypair = Keypair.generate();
    global.keypairs.push(keypair);
    global.publicKeys.push(keypair.publicKey.toBytesCompressed());
  }

  // Set the function test
  const FUNCTION_NAME = "verifyValidAggregatedSignature"; // PLEASE FILL THIS OUT

  const verifyValidAggregatedSignature = function (): void {
    global.verify(global.publicKeys, global.messages, global.signature, global.domain)
  };

  return {
    testFunctions: [verifyValidAggregatedSignature],
    setup: function() {
      const sha256 = require('js-sha256');
      const {aggregateSignatures} = require("../../../src");
      const message = Buffer.from(sha256.arrayBuffer(Math.random().toString(36)));
      const signatures = [];
      global.messages = [];
      global.keypairs.forEach((keypair) => {
        signatures.push(keypair.privateKey.signMessage(message, global.domain).toBytesCompressed());
        global.messages.push(message);
      });
      global.signature = aggregateSignatures(signatures);
    },
    file: dir + FUNCTION_NAME + ".txt",
    // profile: true,
    name: FUNCTION_NAME,
  };
}