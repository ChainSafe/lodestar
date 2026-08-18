import {vi} from "vitest";
import {ApiClientStub, httpClientStub} from "@lodestar/test-utils/apiStub";

export {mockApiErrorResponse, mockApiResponse} from "@lodestar/test-utils/apiStub";

export function getApiClientStub(): ApiClientStub {
  return {
    beacon: {
      getStateValidators: vi.fn(),
      postStateValidators: vi.fn(),
      publishBlindedBlockV2: vi.fn(),
      publishBlockV2: vi.fn(),
      getBlockRoot: vi.fn(),
      submitPoolSyncCommitteeSignatures: vi.fn(),
      submitPoolAttestations: vi.fn(),
      submitPoolAttestationsV2: vi.fn(),
      submitPayloadAttestationMessages: vi.fn(),
    },
    node: {
      getSyncingStatus: vi.fn(),
    },
    validator: {
      getProposerDuties: vi.fn(),
      getProposerDutiesV2: vi.fn(),
      getAttesterDuties: vi.fn(),
      getPtcDuties: vi.fn(),
      prepareBeaconCommitteeSubnet: vi.fn(),
      produceBlockV3: vi.fn(),
      produceBlockV4: vi.fn(),
      getSyncCommitteeDuties: vi.fn(),
      prepareSyncCommitteeSubnets: vi.fn(),
      produceSyncCommitteeContribution: vi.fn(),
      publishContributionAndProofs: vi.fn(),
      submitSyncCommitteeSelections: vi.fn(),
      produceAttestationData: vi.fn(),
      producePayloadAttestationData: vi.fn(),
      getAggregatedAttestation: vi.fn(),
      getAggregatedAttestationV2: vi.fn(),
      publishAggregateAndProofs: vi.fn(),
      publishAggregateAndProofsV2: vi.fn(),
      submitBeaconCommitteeSelections: vi.fn(),
    },
    httpClient: httpClientStub,
  } as unknown as ApiClientStub;
}
