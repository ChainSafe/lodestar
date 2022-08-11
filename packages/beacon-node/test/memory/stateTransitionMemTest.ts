import fs from "fs";
import {createIBeaconConfig, createIChainForkConfig} from "@lodestar/config";
import {praterChainConfig as chainConfig} from "@lodestar/config/networks";
import {stateTransition, createCachedBeaconState, PubkeyIndexMap} from "@lodestar/state-transition";
import {StateContextCache} from "../../src/chain/stateCache/stateContextCache.js";

global.gc?.();
const cache = new StateContextCache({metrics: null});

const config = createIChainForkConfig(chainConfig);

const path = "/Users/tuyennguyen/tuyen/memTest";

const firstState = config.getForkTypes(3628800).BeaconState.deserializeToViewDU(fs.readFileSync(`${path}/state_3628800.ssz`));

// similar to chain.ts
let state = createCachedBeaconState(firstState, {
  config: createIBeaconConfig(config, firstState.genesisValidatorsRoot),
  pubkey2index: new PubkeyIndexMap(),
  index2pubkey: [],
});

cache.add(state);

// const altairState = state as BeaconStateAltair;
// console.log("@@@ sync committee", altairState.currentSyncCommittee);

for (let n = 0; n < 7; n++) {
  for (let i = 0; i < 10; i++) {
    // skip 3628800
    if (n === 0 && i === 0) continue;
    const blockFilePath = `${path}/block_36288${n}${i}.json`;
    if (fs.existsSync(blockFilePath)) {
      const blockBytes = fs.readFileSync(blockFilePath);
      const str = new TextDecoder().decode(blockBytes);
      const json = JSON.parse(str);
      const signedBlock = config.getForkTypes((json.data.message.slot as unknown) as number).SignedBeaconBlock.fromJson(json.data);
      state = stateTransition(state, signedBlock, {
        verifyProposer: false,
        verifySignatures: false,
        verifyStateRoot: true,
      });
      cache.add(state);
      console.log("@@@ successfully process block", signedBlock.message.slot, "cache size", cache.size);
    }
  }
}

const memoryUsage = process.memoryUsage();
console.log("@@@ memory used in MB:", memoryUsage.heapTotal / 1e6);
