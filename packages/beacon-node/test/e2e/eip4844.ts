import {IChainConfig} from "@lodestar/config";
import {SLOTS_PER_EPOCH} from "@lodestar/params";
import {fromHex, sleep, TimestampFormatCode} from "@lodestar/utils";
import {LogLevel, testLogger, TestLoggerOpts} from "../utils/logger.js";
import {getDevBeaconNode} from "../utils/node/beacon.js";
import {getAndInitDevValidators} from "../utils/node/validator.js";

// ```
// lodestar/packages/beacon-node$
// LODESTAR_PRESET=minimal SKIP_SYNC_COMMITTEE=true IGNORE_EIP4844_VALIDAtION=true IGNORE_TRUSTED_SETUP_ERRORS=true ../../node_modules/.bin/ts-node --esm test/e2e/eip4844.ts
// ```

const testParams: Pick<
  IChainConfig,
  "SECONDS_PER_SLOT" | "ALTAIR_FORK_EPOCH" | "BELLATRIX_FORK_EPOCH" | "CAPELLA_FORK_EPOCH" | "EIP4844_FORK_EPOCH"
> = {
  /* eslint-disable @typescript-eslint/naming-convention */
  SECONDS_PER_SLOT: 2,
  ALTAIR_FORK_EPOCH: 0,
  BELLATRIX_FORK_EPOCH: 0,
  CAPELLA_FORK_EPOCH: 0,
  EIP4844_FORK_EPOCH: 0,
};

const restPort = 9000;
const validatorCount = 8;
const genesisEth1BlockHash = "0xbebebebebebebebebebebebebebebebebebebebebebebebebebebebebebebebe";

// delay a bit so regular sync sees it's up to date and sync is completed from the beginning
// also delay to allow bls workers to be transpiled/initialized
const genesisTimeDelaySec = 6;
const genesisTime = Math.floor(Date.now() / 1000) + genesisTimeDelaySec;

const testLoggerOpts: TestLoggerOpts = {
  logLevel: LogLevel.debug,
  timestampFormat: {
    format: TimestampFormatCode.EpochSlot,
    genesisTime,
    slotsPerEpoch: SLOTS_PER_EPOCH,
    secondsPerSlot: testParams.SECONDS_PER_SLOT,
  },
};

const loggerNodeA = testLogger("Node", testLoggerOpts);

const bn = await getDevBeaconNode({
  params: testParams,
  options: {
    sync: {isSingleNode: true},
    network: {allowPublishToZeroPeers: true},
    api: {rest: {enabled: false, api: ["node"], port: restPort, address: "localhost"}},
    chain: {blsVerifyAllMainThread: true},
    executionEngine: {mode: "mock", genesisBlockHash: genesisEth1BlockHash},
  },
  validatorCount,
  genesisTime,
  logger: loggerNodeA,
  eth1BlockHash: fromHex(genesisEth1BlockHash),
});

await getAndInitDevValidators({
  node: bn,
  validatorsPerClient: validatorCount,
  validatorClientCount: 1,
  startIndex: 0,
  useRestApi: false,
  testLoggerOpts: {...testLoggerOpts, logLevel: LogLevel.error},
});

await waitForEpoch(genesisTime, bn.config, 3);

const loggerNodeSync = testLogger("Sync", testLoggerOpts);
const bn2 = await getDevBeaconNode({
  params: testParams,
  options: {
    sync: {isSingleNode: false},
    network: {allowPublishToZeroPeers: true},
    api: {rest: {enabled: false, api: [], port: restPort + 1, address: "localhost"}},
    chain: {blsVerifyAllMainThread: true},
    executionEngine: {mode: "mock", genesisBlockHash: genesisEth1BlockHash},
  },
  validatorCount,
  genesisTime,
  logger: loggerNodeSync,
  eth1BlockHash: fromHex(genesisEth1BlockHash),
});

const bnIdentity = await bn.api.node.getNetworkIdentity();
await bn2.api.lodestar.connectPeer(bnIdentity.data.peerId, bnIdentity.data.p2pAddresses);

await new Promise((r) => setTimeout(r, 300_000));

function waitForEpoch(genesisTime: number, config: IChainConfig, epoch: number): Promise<void> {
  const epochTimeSec = genesisTime + epoch * SLOTS_PER_EPOCH * config.SECONDS_PER_SLOT;
  return sleep(1000 * epochTimeSec - Date.now());
}
