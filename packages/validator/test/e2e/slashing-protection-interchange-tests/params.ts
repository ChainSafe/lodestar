import path from "path";

// Full link: https://github.com/eth2-clients/slashing-protection-interchange-tests/releases/download/v5.1.0/eip-3076-tests-v5.1.0.tar.gz
export const SPEC_TEST_VERSION = "v5.1.0";
export const TESTS_TO_DOWNLOAD = [`eip-3076-tests-${SPEC_TEST_VERSION}`];
export const SPEC_TEST_REPO_URL = "https://github.com/eth2-clients/slashing-protection-interchange-tests";
export const SPEC_TEST_LOCATION = path.join(__dirname, "../../slashing-protection-interchange-spec-tests");

/* eslint-disable @typescript-eslint/naming-convention */
export interface ISlashingProtectionInterchangeTest {
  name: string;
  genesis_validators_root: string;
  steps: [
    {
      should_succeed: boolean;
      contains_slashable_data: boolean;
      interchange: any;
      blocks: {
        pubkey: string;
        should_succeed: boolean;
        slot: string;
        signing_root?: string;
      }[];
      attestations: {
        pubkey: string;
        should_succeed: boolean;
        source_epoch: string;
        target_epoch: string;
        signing_root?: string;
      }[];
    }
  ];
}
