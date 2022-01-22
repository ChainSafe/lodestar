import {SLOTS_PER_EPOCH} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {toHexString} from "@chainsafe/ssz";
import {getDevBeaconNode} from "../utils/node/beacon";
import {waitForEvent} from "../utils/events/resolver";
import {getAndInitDevValidators} from "../utils/node/validator";
import {ChainEvent} from "../../src/chain";
import {RestApiOptions} from "../../src/api/rest";
import {testLogger, TestLoggerOpts, LogLevel} from "../utils/logger";
import {logFilesDir} from "./params";
import {simTestInfoTracker} from "../utils/node/simTest";
import {sleep, TimestampFormatCode} from "@chainsafe/lodestar-utils";
import {initBLS} from "@chainsafe/lodestar-cli/src/util";
import {IChainConfig} from "@chainsafe/lodestar-config";
import {INTEROP_BLOCK_HASH} from "../../src/node/utils/interop/state";
import {createExternalSignerServer} from "@chainsafe/lodestar-validator/test/utils/createExternalSignerServer";

/* eslint-disable no-console, @typescript-eslint/naming-convention */

describe("Run single node single thread interop validators (no eth1) until checkpoint", function () {
  const testParams: Pick<IChainConfig, "SECONDS_PER_SLOT"> = {
    SECONDS_PER_SLOT: 2,
  };

  const validatorClientCount = 1;
  const validatorsPerClient = 32;

  const testCases: {
    event: ChainEvent.justified | ChainEvent.finalized;
    altairEpoch: number;
    bellatrixEpoch: number;
    withExternalSigner?: boolean;
  }[] = [
    // phase0 fork only
    {event: ChainEvent.finalized, altairEpoch: Infinity, bellatrixEpoch: Infinity},
    // altair fork only
    {event: ChainEvent.finalized, altairEpoch: 0, bellatrixEpoch: Infinity},
    // altair fork at epoch 2
    {event: ChainEvent.finalized, altairEpoch: 2, bellatrixEpoch: Infinity},
    // bellatrix fork at epoch 0
    {event: ChainEvent.finalized, altairEpoch: 0, bellatrixEpoch: 0},

    // Remote signer with altair
    {event: ChainEvent.justified, altairEpoch: 0, bellatrixEpoch: Infinity, withExternalSigner: true},
  ];

  before(async function () {
    await initBLS();
  });

  const afterEachCallbacks: (() => Promise<unknown> | unknown)[] = [];
  afterEach(async () => {
    // Run the afterEachCallbacks in a specific order decided latter in the test
    for (let i = 0; i < afterEachCallbacks.length; i++) {
      await afterEachCallbacks[i]?.();
    }
    afterEachCallbacks.length = 0;
  });

  for (const {event, altairEpoch, bellatrixEpoch, withExternalSigner} of testCases) {
    const testIdStr = [
      `altair-${altairEpoch}`,
      `bellatrix-${bellatrixEpoch}`,
      `vc-${validatorClientCount}`,
      `vPc-${validatorsPerClient}`,
      withExternalSigner ? "external_signer" : "local_signer",
      `event-${event}`,
    ].join("_");

    it(`singleNode ${testIdStr}`, async function () {
      // Should reach justification in 3 epochs max, and finalization in 4 epochs max
      const expectedEpochsToFinish = event === ChainEvent.justified ? 3 : 4;
      // 1 epoch of margin of error
      const epochsOfMargin = 1;
      const timeoutSetupMargin = 5 * 1000; // Give extra 5 seconds of margin

      // delay a bit so regular sync sees it's up to date and sync is completed from the beginning
      const genesisSlotsDelay = 3;

      const timeout =
        ((epochsOfMargin + expectedEpochsToFinish) * SLOTS_PER_EPOCH + genesisSlotsDelay) *
        testParams.SECONDS_PER_SLOT *
        1000;

      this.timeout(timeout + 2 * timeoutSetupMargin);

      const genesisTime = Math.floor(Date.now() / 1000) + genesisSlotsDelay * testParams.SECONDS_PER_SLOT;

      const testLoggerOpts: TestLoggerOpts = {
        logLevel: LogLevel.info,
        logFile: `${logFilesDir}/singlethread_singlenode_${testIdStr}.log`,
        timestampFormat: {
          format: TimestampFormatCode.EpochSlot,
          genesisTime,
          slotsPerEpoch: SLOTS_PER_EPOCH,
          secondsPerSlot: testParams.SECONDS_PER_SLOT,
        },
      };
      const loggerNodeA = testLogger("Node-A", testLoggerOpts);

      const bn = await getDevBeaconNode({
        params: {...testParams, ALTAIR_FORK_EPOCH: altairEpoch, BELLATRIX_FORK_EPOCH: bellatrixEpoch},
        options: {
          api: {rest: {enabled: true} as RestApiOptions},
          sync: {isSingleNode: true},
          executionEngine: {mode: "mock", genesisBlockHash: toHexString(INTEROP_BLOCK_HASH)},
        },
        validatorCount: validatorClientCount * validatorsPerClient,
        logger: loggerNodeA,
        genesisTime,
      });
      afterEachCallbacks[3] = () => bn.close();

      const stopInfoTracker = simTestInfoTracker(bn, loggerNodeA);
      afterEachCallbacks[2] = () => stopInfoTracker();

      const externalSignerPort = 38000;
      const externalSignerUrl = `http://localhost:${externalSignerPort}`;

      const {validators, secretKeys} = await getAndInitDevValidators({
        node: bn,
        validatorsPerClient,
        validatorClientCount,
        startIndex: 0,
        // At least one sim test must use the REST API for beacon <-> validator comms
        useRestApi: true,
        testLoggerOpts,
        externalSignerUrl: withExternalSigner ? externalSignerUrl : undefined,
      });

      if (withExternalSigner) {
        const server = createExternalSignerServer(secretKeys);
        afterEachCallbacks[0] = () => server.close();
        await server.listen(externalSignerPort);
      }

      // TODO: Previous code waited for 1 slot between stopping the validators and stopInfoTracker()
      afterEachCallbacks[1] = () => Promise.all(validators.map((v) => v.stop()));
      await Promise.all(validators.map((v) => v.start()));

      // Wait for test to complete
      await waitForEvent<phase0.Checkpoint>(bn.chain.emitter, event, timeout);

      console.log(`\nGot event ${event}, stopping validators and nodes\n`);

      // wait for 1 slot
      await sleep(1 * bn.config.SECONDS_PER_SLOT * 1000);
      console.log("\n\nDone\n\n");
      await sleep(1000);
    });
  }
});
