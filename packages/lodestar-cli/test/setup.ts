import {initBLS} from "@chainsafe/bls";
import {before, after} from "mocha";
import rimraf from "rimraf";
import {tmpDir} from "./constants";
import { mkdir } from "fs";

const ganache = require("ganache-core");

const server = ganache.server();
const provider = server.provider;

before(async () => {
  await initBLS();
  server.listen(8545, function(err: any, blockchain: any) { 
    console.log('error: ', err);
   });
  // mkdir("./tmp", () => {});
});

after(async () => {
  server.close((a: any) => console.log('closing server....', a))
  await new Promise(resolve => rimraf(tmpDir, resolve));
});