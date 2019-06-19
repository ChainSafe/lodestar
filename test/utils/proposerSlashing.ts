import {ProposerSlashing} from "../../src/types";
import {blockHeaderFromYaml} from "./block";

export function proposerSlashingFromYaml(value: any): ProposerSlashing {
  return {
    header1: blockHeaderFromYaml(value.header1),
    header2: blockHeaderFromYaml(value.header2),
    proposerIndex: value.proposerIndex.toNumber()
  };
}
