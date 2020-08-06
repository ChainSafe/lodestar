import {initBLS} from "@chainsafe/bls";
import {before, after} from "mocha";
import rimraf from "rimraf";
import {rootDir} from "./constants";

import  ganache from "ganache-core";

const server = ganache.server();
const provider = server.provider;

before(async () => {
  await initBLS();
  server.listen(8545);
});

after(async () => {
  server.close();
  await new Promise(resolve => rimraf(rootDir, resolve));
});