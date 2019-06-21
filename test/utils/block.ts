import {BeaconBlock, BeaconBlockHeader} from "../../src/types";
import {EMPTY_SIGNATURE, ZERO_HASH} from "../../src/constants";
import {eth1DataFromYaml} from "./eth1Data";
import {proposerSlashingFromYaml} from "./proposerSlashing";
import {attestationFromYaml} from "./attestation";
import voluntaryExits from "../../src/chain/stateTransition/block/voluntaryExits";
import {transfersFromYaml} from "./transfer";
import {voluntaryExitsFromYaml} from "./voluntaryExits";
import {depositsFromYaml} from "./deposit";
import {attesterSlashingFromYaml} from "./attesterSlashing";


export function generateEmptyBlock(): BeaconBlock {
  return {
    slot: 0,
    parentRoot: Buffer.alloc(32),
    stateRoot: ZERO_HASH,
    body: {
      randaoReveal: Buffer.alloc(96),
      eth1Data: {
        depositRoot: Buffer.alloc(32),
        blockHash: Buffer.alloc(32),
        depositCount: 0,
      },
      graffiti: Buffer.alloc(32),
      proposerSlashings: [],
      attesterSlashings: [],
      attestations: [],
      deposits: [],
      voluntaryExits: [],
      transfers: [],
    },
    signature: EMPTY_SIGNATURE,
  };
}

export function blockFromYaml(value: any): BeaconBlock {
  return {
    body: {
      randaoReveal: Buffer.from(value.body.randaoReveal.slice(2), 'hex'),
      eth1Data: eth1DataFromYaml(value.body.eth1Data),
      graffiti: Buffer.from(value.body.graffiti.slice(2), 'hex'),
      proposerSlashings: value.body.proposerSlashings.map(proposerSlashingFromYaml),
      attesterSlashings: value.body.attesterSlashings.map(attesterSlashingFromYaml),
      attestations: value.body.attestations.map(attestationFromYaml),
      deposits: value.body.deposits.map(depositsFromYaml),
      voluntaryExits: value.body.voluntaryExits.map(voluntaryExitsFromYaml),
      transfers: value.body.transfers.map(transfersFromYaml)
    },
    parentRoot: Buffer.from(value.parentRoot.slice(2), 'hex'),
    signature: Buffer.from(value.signature.slice(2), 'hex'),
    slot: value.slot.toNumber(),
    stateRoot: Buffer.from(value.stateRoot.slice(2), 'hex')
  };
}

export function blockHeaderFromYaml(value: any): BeaconBlockHeader {
  return {
    parentRoot: Buffer.from(value.parentRoot.slice(2), 'hex'),
    signature: Buffer.from(value.signature.slice(2), 'hex'),
    slot: value.slot.toNumber(),
    stateRoot: Buffer.from(value.stateRoot.slice(2), 'hex'),
    bodyRoot: Buffer.from(value.blockBodyRoot.slice(2), 'hex'),
  };

}
