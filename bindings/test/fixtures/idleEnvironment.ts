import assert from "node:assert/strict";
import {parentPort} from "node:worker_threads";
import {mainnetChainConfig} from "@lodestar/config/configs";
import {SecretKey} from "../../src/blst.js";
import bindings from "../../src/index.js";

Object.assign(globalThis, {config: new bindings.BeaconConfig(mainnetChainConfig, new Uint8Array(32))});
assert.equal(SecretKey.fromKeygen(new Uint8Array(32).fill(1)).toPublicKey().toBytes().length, 48);
assert(parentPort);
parentPort.ref();
parentPort.postMessage("ready");
