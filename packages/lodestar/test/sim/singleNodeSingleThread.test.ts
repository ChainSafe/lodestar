import {IBeaconParams} from "@chainsafe/lodestar-params";
import {phase0} from "@chainsafe/lodestar-types";
import {getDevBeaconNode} from "../utils/node/beacon";
import {waitForEvent} from "../utils/events/resolver";
import {getDevValidators} from "../utils/node/validator";
import {ChainEvent} from "../../src/chain";
import {IRestApiOptions} from "../../src/api/rest/options";
import {testLogger, LogLevel} from "../utils/logger";
import {logFiles} from "./params";
import {simTestInfoTracker} from "../utils/node/simTest";
import {sleep} from "@chainsafe/lodestar-utils";

/* eslint-disable no-console */

describe("Run single node single thread interop validators (no eth1) until checkpoint", function () {
  const timeout = 120 * 1000;
  const testParams: Partial<IBeaconParams> = {
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SECONDS_PER_SLOT: 2,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    SLOTS_PER_EPOCH: 8,
  };
  const manyValidatorParams: Partial<IBeaconParams> = {
    ...testParams,
    // eslint-disable-next-line @typescript-eslint/naming-convention
    TARGET_AGGREGATORS_PER_COMMITTEE: 1,
  };

  const loggerNodeA = testLogger("Node-A", LogLevel.info, logFiles.singlenodeSinglethread);

  const testCases: {
    validatorClientCount: number;
    validatorsPerClient: number;
    event: ChainEvent.justified | ChainEvent.finalized;
    params: Partial<IBeaconParams>;
  }[] = [
    {validatorClientCount: 8, validatorsPerClient: 8, event: ChainEvent.justified, params: testParams},
    {validatorClientCount: 8, validatorsPerClient: 8, event: ChainEvent.finalized, params: testParams},
    {validatorClientCount: 1, validatorsPerClient: 32, event: ChainEvent.justified, params: manyValidatorParams},
  ];

  for (const testCase of testCases) {
    it(`${testCase.validatorClientCount} vc / ${testCase.validatorsPerClient} validator > until ${testCase.event}`, async function () {
      this.timeout(timeout);
      const bn = await getDevBeaconNode({
        params: testCase.params,
        options: {sync: {minPeers: 0}, api: {rest: {enabled: true} as IRestApiOptions}},
        validatorCount: testCase.validatorClientCount * testCase.validatorsPerClient,
        logger: loggerNodeA,
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
        logLevel: LogLevel.info,
        logFile: logFiles.singlenodeSinglethread,
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
