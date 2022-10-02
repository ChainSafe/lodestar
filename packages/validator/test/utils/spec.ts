import fs from "node:fs";
import path from "node:path";

/* eslint-disable @typescript-eslint/naming-convention */
export type SlashingProtectionInterchangeTest = {
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
};

export function loadTestCases(testsPath: string): SlashingProtectionInterchangeTest[] {
  const files = fs.readdirSync(testsPath);
  if (files.length === 0) {
    throw Error(`Not tests found in ${testsPath}`);
  }
  return files.map(
    (file) => JSON.parse(fs.readFileSync(path.join(testsPath, file), "utf8")) as SlashingProtectionInterchangeTest
  );
}
