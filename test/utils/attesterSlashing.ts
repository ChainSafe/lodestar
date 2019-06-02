import {AttesterSlashing} from "../../src/types";
import {indexedAttestationFromYaml} from "./attestation";

export function attesterSlashingFromYaml(value: any): AttesterSlashing {
  return {
    attestation1: indexedAttestationFromYaml(value.attestation1),
    attestation2: indexedAttestationFromYaml(value.attestation2)
  };
}
