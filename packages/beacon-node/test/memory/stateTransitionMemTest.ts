/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
import fs from "node:fs";
import {createIBeaconConfig, createIChainForkConfig} from "@lodestar/config";
import {praterChainConfig as chainConfig} from "@lodestar/config/networks";
import {stateTransition, createCachedBeaconState, PubkeyIndexMap} from "@lodestar/state-transition";
import {WinstonLogger} from "@lodestar/utils";
import {StateContextCache} from "../../src/chain/stateCache/stateContextCache.js";

/**
 * To run this file, download state 3628800 and blocks from 3628800 to 3628869 of prater network.
 * As of Aug 2022, it takes around 950MB to 980MB to run the below state transition test.
 */
const logger = new WinstonLogger();
global.gc?.();
const cache = new StateContextCache({metrics: null});

const config = createIChainForkConfig(chainConfig);

const path = "/Users/tuyennguyen/tuyen/memTest";

const firstState = config
  .getForkTypes(3628800)
  .BeaconState.deserializeToViewDU(fs.readFileSync(`${path}/state_3628800.ssz`));

// similar to chain.ts
let state = createCachedBeaconState(firstState, {
  config: createIBeaconConfig(config, firstState.genesisValidatorsRoot),
  pubkey2index: new PubkeyIndexMap(),
  index2pubkey: [],
});

cache.add(state);

for (let n = 0; n < 7; n++) {
  for (let i = 0; i < 10; i++) {
    // skip 3628800
    if (n === 0 && i === 0) continue;
    const blockFilePath = `${path}/block_36288${n}${i}.json`;
    if (fs.existsSync(blockFilePath)) {
      const blockBytes = fs.readFileSync(blockFilePath);
      const str = new TextDecoder().decode(blockBytes);
      const json = JSON.parse(str);
      const signedBlock = config
        .getForkTypes((json.data.message.slot as unknown) as number)
        .SignedBeaconBlock.fromJson(json.data);
      state = stateTransition(state, signedBlock, {
        verifyProposer: false,
        verifySignatures: false,
        verifyStateRoot: true,
      });
      cache.add(state);
      logger.info("successfully process block", {slot: signedBlock.message.slot, cached: cache.size});
    }
  }
}

const memoryUsage = process.memoryUsage();
logger.info("heap used in MB:", memoryUsage.heapTotal / 1e6);
