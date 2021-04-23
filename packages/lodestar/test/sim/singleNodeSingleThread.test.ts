import {IBeaconParams} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {getDevBeaconNode} from "../utils/node/beacon";
import {waitForEvent} from "../utils/events/resolver";
import {getDevValidators} from "../utils/node/validator";
import {ChainEvent} from "../../src/chain";
import {IRestApiOptions} from "../../src/api/rest/options";
import {testLogger, TestLoggerOpts, LogLevel} from "../utils/logger";
import {logFiles} from "./params";
import {simTestInfoTracker} from "../utils/node/simTest";
import {sleep, TimestampFormatCode} from "@chainsafe/lodestar-utils";

/* eslint-disable no-console, @typescript-eslint/naming-convention */

describe("Run single node single thread interop validators (no eth1) until checkpoint", function () {
  const timeout = 120 * 1000;
  const testParams: Pick<IBeaconParams, "SECONDS_PER_SLOT" | "SLOTS_PER_EPOCH"> = {
    SECONDS_PER_SLOT: 2,
    SLOTS_PER_EPOCH: 8,
  };
  const manyValidatorParams: Partial<IBeaconParams> = {
    ...testParams,
    TARGET_AGGREGATORS_PER_COMMITTEE: 1,
  };

  const testCases: {
    validatorClientCount: number;
    validatorsPerClient: number;
    event: ChainEvent.justified | ChainEvent.finalized;
    params: Partial<IBeaconParams>;
  }[] = [
    {validatorClientCount: 1, validatorsPerClient: 32, event: ChainEvent.justified, params: manyValidatorParams},
    {validatorClientCount: 8, validatorsPerClient: 8, event: ChainEvent.justified, params: testParams},
    {validatorClientCount: 8, validatorsPerClient: 8, event: ChainEvent.finalized, params: testParams},
  ];

  for (const testCase of testCases) {
    it(`${testCase.validatorClientCount} vc / ${testCase.validatorsPerClient} validator > until ${testCase.event}`, async function () {
      this.timeout(timeout);

      const genesisTime = Math.floor(Date.now() / 1000);
      const testLoggerOpts: TestLoggerOpts = {
        logLevel: LogLevel.info,
        logFile: logFiles.singlenodeSinglethread,
        timestampFormat: {
          format: TimestampFormatCode.EpochSlot,
          genesisTime,
          slotsPerEpoch: testParams.SLOTS_PER_EPOCH,
          secondsPerSlot: testParams.SECONDS_PER_SLOT,
        },
      };
      const loggerNodeA = testLogger("Node-A", testLoggerOpts);

      const bn = await getDevBeaconNode({
        params: testCase.params,
        options: {sync: {minPeers: 0}, api: {rest: {enabled: true} as IRestApiOptions}},
        validatorCount: testCase.validatorClientCount * testCase.validatorsPerClient,
        logger: loggerNodeA,
        genesisTime,
      });

      const stopInfoTracker = simTestInfoTracker(bn, loggerNodeA);

      const justificationEventListener = waitForEvent<phase0.Checkpoint>(
        bn.chain.emitter,
        testCase.event,
        timeout - 10 * 1000
      );

      const validators = getDevValidators({
        node: bn,
        validatorsPerClient: testCase.validatorsPerClient,
        validatorClientCount: testCase.validatorClientCount,
        startIndex: 0,
        // At least one sim test must use the REST API for beacon <-> validator comms
        useRestApi: true,
        testLoggerOpts,
      });

      await Promise.all(validators.map((v) => v.start()));

      try {
        await justificationEventListener;
        console.log(`\nGot event ${testCase.event}, stopping validators and nodes\n`);
      } catch (e) {
        (e as Error).message = `failed to get event: ${testCase.event}: ${(e as Error).message}`;
        throw e;
      } finally {
        await Promise.all(validators.map((v) => v.stop()));

        // wait for 1 slot
        await sleep(1 * bn.config.params.SECONDS_PER_SLOT * 1000);
        stopInfoTracker();
        await bn.close();
        console.log("\n\nDone\n\n");
        await sleep(1000);
      }
    });
  }
});
