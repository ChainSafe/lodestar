import * as i from "../src/interface";
import * as types from "../src/types";
import * as backings from "../src/backings";
import * as mtree from "@chainsafe/merkle-tree";
// @ts-ignore
import benchmark from "benchmark";
// @ts-ignore
import {randomBytes} from "bcrypto/lib/random";

const suite = new benchmark.Suite;

const buffer = new ArrayBuffer(8192);

const arr0 = new Uint8Array(buffer);
const arr1 = new Uint8Array(buffer);

function randomIndex(): number {
  return Math.round(Math.random() * buffer.byteLength - 32);
}

function writeBytes0(): void {
  const i = randomIndex();
  arr0.set(randomBytes(32), i);
}

function writeBytes1(): void {
  const i = randomIndex();
  (new Uint8Array(arr1.buffer, i)).set(randomBytes(32));
}

suite
  .add("write uint8array with offset", () => writeBytes0)
  .add("write new uint8array w/o offset", () => writeBytes1)

  .on('cycle', function(event: any) {
    console.log(String(event.target));
  })
  .run({ 'async': true });
