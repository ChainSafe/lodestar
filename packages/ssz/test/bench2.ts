import * as ssz from "../src";
import * as types from "../src/types";
import * as backings from "../src/backings";
import * as mtree from "@chainsafe/merkle-tree";

const m = mtree;

// validator registry

interface Validator {
  pubkey: Uint8Array;
  withdrawalCredentials: Uint8Array;
  effectiveBalance: bigint;
  slashed: boolean;
  activationEligibilityEpoch: number;
  activationEpoch: number;
  exitEpoch: number;
  withdrawalEpoch: number;
}

type ValidatorRegistry = ArrayLike<Validator>;

const validatorType1 = ssz.parseType({
  fields: [
    ["pubkey", "bytes48"],
    ["withdrawalCredentials", "bytes32"],
    ["effectiveBalance", "bigint64"],
    ["slashed", "bool"],
    ["activationEligibilityEpoch", "number64"],
    ["activationEpoch", "number64"],
    ["exitEpoch", "number64"],
    ["withdrawalEpoch", "number64"],
  ],
});

const validatorRegistryType1 = ssz.parseType({
  elementType: validatorType1,
  maxLength: 2 ** 40
});

// set up new type

const number64Type = new types.NumberUintType({byteLength: 8});
const bigint64Type = new types.BigIntUintType({byteLength: 8});
const bytes48Type =  new types.ByteVectorType({length: 48});
const bytes32Type =  new types.ByteVectorType({length: 32});

const validatorType2 = new types.ContainerType<Validator>({fields: [
  ["pubkey", bytes48Type],
  ["withdrawalCredentials", bytes32Type],
  ["effectiveBalance", bigint64Type],
  ["slashed", types.booleanType],
  ["activationEligibilityEpoch", number64Type],
  ["activationEpoch", number64Type],
  ["exitEpoch", number64Type],
  ["withdrawalEpoch", number64Type],
]})

const validatorRegistryType2 = new types.ListType<ValidatorRegistry>({
  elementType: validatorType2,
  limit: 2 ** 40
})

// @ts-ignore
import {randomBytes} from "bcrypto/lib/random";

const randomValidator = (): Validator => {
  return {
    pubkey: randomBytes(48),
    withdrawalCredentials: randomBytes(32),
    effectiveBalance: BigInt(Math.round(Math.random() * 1000)),
    slashed: Math.round(Math.random()) ? true : false,
    activationEligibilityEpoch: Math.round(Math.random() * 1000),
    activationEpoch: Math.round(Math.random() * 1000),
    exitEpoch: Math.round(Math.random() * 1000),
    withdrawalEpoch: Math.round(Math.random() * 1000),
  };
}

const r1: ValidatorRegistry = [{
  pubkey: new Uint8Array(48),
  withdrawalCredentials: new Uint8Array(32),
  effectiveBalance: BigInt(65),
  slashed: true,
  activationEligibilityEpoch: 0,
  activationEpoch: 0,
  exitEpoch: 0,
  withdrawalEpoch: 0
}]
const r2: ValidatorRegistry = [...(r1 as [])];

const r3 = validatorRegistryType2.tree.defaultValue();

const v1 = r1[0];
const v2 = validatorType2.tree.defaultValue();
debugger;
v2.slashed = true;


console.log(r3)
console.log(r3.hashTreeRoot())
console.log(ssz.hashTreeRoot(validatorRegistryType1, []));

//console.log(ssz.serialize(validatorRegistryType1, []));
//console.log(validatorRegistryType2.serialize([]));
//console.log(r2.size())
//console.log(r2.length)
//console.log(r2.serialize())
//console.log(r2.hashTreeRoot())
//console.log(r2.hashTreeRoot());
//console.log(ssz.hashTreeRoot(validatorRegistryType1, r1));
//console.log(x.hashTreeRoot());
//console.log(ssz.hashTreeRoot(validatorType1, r1[0]));
//console.log(ssz.serialize(validatorRegistryType1, r1).equals(Buffer.from(validatorRegistryType2.serialize(r1))));
//console.log(ssz.hashTreeRoot(validatorRegistryType1, r1).equals(Buffer.from(validatorRegistryType2.hashTreeRoot(r1))));
//console.log(ssz.serialize(validatorRegistryType1, r1).equals(Buffer.from(validatorRegistryType2.serialize(r2))))
//console.log(ssz.hashTreeRoot(validatorRegistryType1, r1).equals(Buffer.from(validatorRegistryType2.hashTreeRoot(r2))))
//r2[0].activationEpoch = 5
//console.log(r2)

import benchmark from "benchmark";

/*

const suite = new benchmark.Suite;

const rr1: ValidatorRegistry & Validator[] = []
const rr2: ValidatorRegistry & Validator[] = []
const rr3: ValidatorRegistry & Validator[] = []
const rr4: ValidatorRegistry & Validator[] = []

const rr5: ValidatorRegistry & Validator[] = []
rr1.push(randomValidator());
rr2.push(randomValidator());
rr1.push(randomValidator());
rr2.push(randomValidator());
rr1.push(randomValidator());
rr2.push(randomValidator());

for (let i = 0; i < 100; i++) {
  rr5.push(randomValidator());
  console.log(i, ssz.serialize(validatorRegistryType1, rr5).equals(Buffer.from(validatorRegistryType2.serialize(rr5))));
}

function runV (r: ValidatorRegistry & Validator[], x: (rr: ValidatorRegistry & Validator[]) => void): void {
  r.push(randomValidator());
  r.push(randomValidator());
  r.push(randomValidator());
  r.push(randomValidator());
  r.push(randomValidator());
  x(r);
}

suite
  .add("old - serialize", () => runV(rr1, (v) => ssz.serialize(validatorRegistryType1, v)))
  .add("structural - alt - serialize", () => runV(rr2, (v) => validatorRegistryType2.serialize(v)))
  .add("old - hashTreeRoot", () => rr3.push(randomValidator()) && ssz.hashTreeRoot(validatorRegistryType1, rr3))
  .add("structural - alt - hashTreeRoot", () =>  rr4.push(randomValidator()) && validatorRegistryType2.hashTreeRoot(rr4))
//.add("structural - serialize", () =>  r2.serialize())
//  .add("old - hashTreeRoot", () => ssz.hashTreeRoot(validatorRegistryType1, r1))
// .add("structural - alt - hashTreeRoot", () =>  validatorRegistryType2.hashTreeRoot(r1))
// .add("structural - hashTreeRoot", () => r2.hashTreeRoot())
  .on('cycle', function(event: any) {
    console.log(String(event.target));
  })
  .run({ 'async': true });
 */

/*

const suiteb = new benchmark.Suite;

suiteb
  .add("Buffer copy", () => Buffer.alloc(32).copy(Buffer.alloc(32)))
  .add("Uint8Array set", () => (new Uint8Array(32)).set(new Uint8Array(32)))
  .on('cycle', function(event: any) {
    console.log(String(event.target));
  })
  .run({ 'async': true });

 */
