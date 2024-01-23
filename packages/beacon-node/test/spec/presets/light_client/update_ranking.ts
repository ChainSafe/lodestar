import {expect} from "vitest";
import {altair, ssz, allForks} from "@lodestar/types";
import {isForkLightClient} from "@lodestar/params";
import {InputType} from "@lodestar/spec-test-util";
import {isBetterUpdate, LightClientUpdateSummary, toLightClientUpdateSummary} from "@lodestar/light-client/spec";
import {TestRunnerFn} from "../../utils/types.js";

/* eslint-disable @typescript-eslint/naming-convention */

// https://github.com/ethereum/consensus-specs/blob/da3f5af919be4abb5a6db5a80b235deb8b4b5cba/tests/formats/light_client/update_ranking.md
type UpdateRankingTestCase = {
  meta: {
    updates_count: bigint;
  };
};

// updates_<index>.ssz_snappy
const UPDATES_FILE_NAME = "^updates_([0-9]+)$";

export const updateRanking: TestRunnerFn<UpdateRankingTestCase, void> = (fork) => {
  return {
    testFunction: (testcase) => {
      // Parse update files
      const updatesCount = Number(testcase.meta.updates_count as bigint);
      const updates: allForks.LightClientUpdate[] = [];

      for (let i = 0; i < updatesCount; i++) {
        const update = (testcase as unknown as Record<string, altair.LightClientUpdate>)[`updates_${i}`];
        if (update === undefined) {
          throw Error(`no update for index ${i}`);
        }
        updates[i] = update;
      }

      // A test-runner should load the provided update objects and verify that the local implementation ranks them in the same order
      // best update at index 0
      for (let i = 0; i < updatesCount - 1; i++) {
        const newUpdate = toLightClientUpdateSummary(updates[i]);
        const oldUpdate = toLightClientUpdateSummary(updates[i + 1]);

        expect(isBetterUpdate(newUpdate, oldUpdate)).equals(
          true,
          // Print update summary for easier debugging
          `update ${i} must be better than ${i + 1}
oldUpdate = ${renderUpdate(oldUpdate)}
newUpdate = ${renderUpdate(newUpdate)}
`
        );
      }
    },
    options: {
      inputTypes: {
        meta: InputType.YAML,
      },
      sszTypes: {
        [UPDATES_FILE_NAME]: isForkLightClient(fork)
          ? ssz.allForksLightClient[fork].LightClientUpdate
          : ssz.altair.LightClientUpdate,
      },
      // eslint-disable-next-line @typescript-eslint/no-empty-function
      expectFunc: () => {},
      // Do not manually skip tests here, do it in packages/beacon-node/test/spec/presets/index.test.ts
    },
  };
};

function renderUpdate(update: LightClientUpdateSummary): string {
  return JSON.stringify(update, null, 2);
}
