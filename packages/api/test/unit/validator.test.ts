import sinon from "sinon";
import {expect} from "chai";
import {ForkName} from "@chainsafe/lodestar-config";
import {config} from "@chainsafe/lodestar-config/minimal";
import {mapValues} from "@chainsafe/lodestar-utils";
import {Api, ReqTypes, routesData, getReqSerdes, getReturnTypes} from "../../src/routes/validator";
import {getGenericClient, Resolves, RouteGeneric} from "../../src/utils";
import {getFetchFn, getTestServer} from "./utils";

/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/naming-convention */

const ZERO_HASH = Buffer.alloc(32, 0);

type IgnoreVoid<T> = T extends void ? undefined : T;

describe("validator", () => {
  const reqSerdes = getReqSerdes(config);
  const returnTypes = getReturnTypes(config);

  const mockApi = mapValues(routesData, () => sinon.stub()) as sinon.SinonStubbedInstance<Api>;
  const {baseUrl} = getTestServer<Api, ReqTypes>(routesData, reqSerdes, returnTypes, mockApi);
  const fetchFn = getFetchFn(baseUrl);
  const client = getGenericClient<Api, ReqTypes>(routesData, reqSerdes, returnTypes, fetchFn);

  const testCases: {
    [K in keyof Api]: {args: Parameters<Api[K]>; res: IgnoreVoid<Resolves<Api[K]>>};
  } = {
    getAttesterDuties: {
      args: [1000, [1, 2, 3]],
      res: {data: [config.types.phase0.AttesterDuty.defaultValue()], dependentRoot: ZERO_HASH},
    },
    getProposerDuties: {
      args: [1000],
      res: {data: [config.types.phase0.ProposerDuty.defaultValue()], dependentRoot: ZERO_HASH},
    },
    getSyncCommitteeDuties: {
      args: [1000, [1, 2, 3]],
      res: {data: [config.types.altair.SyncDuty.defaultValue()], dependentRoot: ZERO_HASH},
    },
    produceBlock: {
      args: [32000, Buffer.alloc(96, 1), "graffiti"],
      res: {data: config.types.phase0.BeaconBlock.defaultValue(), version: ForkName.phase0},
    },
    produceAttestationData: {
      args: [2, 32000],
      res: {data: config.types.phase0.AttestationData.defaultValue()},
    },
    produceSyncCommitteeContribution: {
      args: [32000, 2, ZERO_HASH],
      res: {data: config.types.altair.SyncCommitteeContribution.defaultValue()},
    },
    getAggregatedAttestation: {
      args: [ZERO_HASH, 32000],
      res: {data: config.types.phase0.Attestation.defaultValue()},
    },
    publishAggregateAndProofs: {
      args: [[config.types.phase0.SignedAggregateAndProof.defaultValue()]],
      res: undefined,
    },
    publishContributionAndProofs: {
      args: [[config.types.altair.SignedContributionAndProof.defaultValue()]],
      res: undefined,
    },
    prepareBeaconCommitteeSubnet: {
      args: [[config.types.phase0.BeaconCommitteeSubscription.defaultValue()]],
      res: undefined,
    },
    prepareSyncCommitteeSubnets: {
      args: [[config.types.altair.SyncCommitteeSubscription.defaultValue()]],
      res: undefined,
    },
  };

  for (const [key, testCase] of Object.entries(testCases)) {
    const routeId = key as keyof Api;

    it(routeId, async () => {
      mockApi[routeId].reset();

      // Register mock data
      mockApi[routeId].resolves(testCase.res as any);

      // Do the call
      const res = await (client[routeId] as RouteGeneric)(...testCase.args);

      // Assert server handler called with correct args
      expect(mockApi[routeId].callCount).to.equal(1, `mockApi[${routeId}] must be called once`);
      expect(mockApi[routeId].getCall(0).args).to.deep.equal(testCase.args, `mockApi[${routeId}] wrong args`);

      // Assert returned value is correct
      expect(res).to.deep.equal(testCase.res, "Wrong returned value");
    });
  }
});
