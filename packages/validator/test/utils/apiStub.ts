import {vi, Mocked} from "vitest";
import {Api} from "@lodestar/api";

export function getApiClientStub(): {[K in keyof Api]: Mocked<Api[K]>} {
  return {
    beacon: {
      getStateValidators: vi.fn(),
      publishBlindedBlockV2: vi.fn(),
      publishBlockV2: vi.fn(),
      submitPoolSyncCommitteeSignatures: vi.fn(),
      submitPoolAttestations: vi.fn(),
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
      publishAggregateAndProofs: vi.fn(),
      submitBeaconCommitteeSelections: vi.fn(),
    },
  } as unknown as {[K in keyof Api]: Mocked<Api[K]>};
}
