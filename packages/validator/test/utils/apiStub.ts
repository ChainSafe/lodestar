import {vi, Mocked} from "vitest";
import {ApiClientMethods, ApiResponse, Endpoint, Endpoints, HttpStatusCode, IHttpClient} from "@lodestar/api";

type ApiClientStub = {[K in keyof Endpoints]: Mocked<ApiClientMethods<Endpoints[K]>>} & {
  httpClient: Mocked<IHttpClient>;
};

const httpClientStub: IHttpClient = {
  baseUrl: "",
  request: vi.fn(),
  urlsInits: [],
  urlsScore: [],
};

export function getApiClientStub(): ApiClientStub {
  return {
    beacon: {
      getStateValidators: vi.fn(),
      postStateValidators: vi.fn(),
      publishBlindedBlockV2: vi.fn(),
      publishBlockV2: vi.fn(),
      submitPoolSyncCommitteeSignatures: vi.fn(),
      submitPoolAttestations: vi.fn(),
      submitPoolAttestationsV2: vi.fn(),
    },
    node: {
      getSyncingStatus: vi.fn(),
    },
    validator: {
      getProposerDuties: vi.fn(),
      getAttesterDuties: vi.fn(),
      prepareBeaconCommitteeSubnet: vi.fn(),
      produceBlockV3: vi.fn(),
      getSyncCommitteeDuties: vi.fn(),
      prepareSyncCommitteeSubnets: vi.fn(),
      produceSyncCommitteeContribution: vi.fn(),
      publishContributionAndProofs: vi.fn(),
      submitSyncCommitteeSelections: vi.fn(),
      produceAttestationData: vi.fn(),
      getAggregatedAttestation: vi.fn(),
      getAggregatedAttestationV2: vi.fn(),
      publishAggregateAndProofs: vi.fn(),
      publishAggregateAndProofsV2: vi.fn(),
      submitBeaconCommitteeSelections: vi.fn(),
    },
    httpClient: httpClientStub,
  } as unknown as ApiClientStub;
}

export function mockApiResponse<T, M, E extends Endpoint<any, any, any, T, M>>({
  data,
  meta,
}: (E["return"] extends void ? {data?: never} : {data: E["return"]}) &
  (E["meta"] extends void ? {meta?: never} : {meta: E["meta"]})): ApiResponse<E> {
  const response = new Response(null, {status: HttpStatusCode.OK});
  const apiResponse = new ApiResponse<E>({} as any, null, response);
  apiResponse.value = () => data as T;
  apiResponse.meta = () => meta as M;
  return apiResponse;
}
