import * as ssz from "../src";
import * as types from "../src/types";
import * as backings from "../src/backings";
import * as mtree from "@chainsafe/merkle-tree";
// @ts-ignore
import benchmark from "benchmark";
// @ts-ignore
import {randomBytes} from "bcrypto/lib/random";

const b = backings;

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

type ValidatorRegistry = types.ArrayLike<Validator>;

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

const struct10k: ValidatorRegistry = Array.from({length: 10000}, randomValidator);
//const struct100k: ValidatorRegistry = Array.from({length: 100000}, randomValidator);
//const struct1m: ValidatorRegistry = Array.from({length: 1000000}, randomValidator);

const tree10k: ValidatorRegistry = validatorRegistryType2.tree.createValue(struct10k);
//const tree100k: ValidatorRegistry = validatorRegistryType2.tree.createValue(struct100k);
//const tree1m: ValidatorRegistry = validatorRegistryType2.tree.createValue(struct1m);

const suite = new benchmark.Suite;

function randInt(max: number) {
  return Math.round((max - 1) * Math.random());
}

function updateValidator(registry: ValidatorRegistry): boolean {
  const index = randInt(registry.length);
  registry[index] = randomValidator();
  return true;
}

suite
// @ts-ignore
  .add("iterate - structural - 10k", () => {for (const v of struct10k) {}})
// @ts-ignore
  .add("iterate - tree - 10k", () => {for (const v of tree10k) {}})
//
  .add("get validator - structural - 10k", () => struct10k[randInt(10000)])
  .add("get validator - tree - 10k", () => tree10k[randInt(10000)])
//
  .add("get validator property - structural - 10k", () => struct10k[randInt(10000)].withdrawalEpoch)
  .add("get validator property - tree - 10k", () => tree10k[randInt(10000)].withdrawalEpoch)
//
  .add("set validator - structural - 10k", () => struct10k[randInt(10000)] = randomValidator())
  .add("set validator - tree - 10k", () => tree10k[randInt(10000)] = randomValidator())
//
  .add("set validator property - structural - 10k", () => struct10k[randInt(10000)].withdrawalEpoch = randInt(100))
  .add("set validator property - tree - 10k", () => tree10k[randInt(10000)].withdrawalEpoch = randInt(100))
//
  .add("serialize - old - 10k", () => updateValidator(struct10k) && ssz.serialize(validatorRegistryType1, struct10k))
  .add("serialize - structural - 10k", () => updateValidator(struct10k) && validatorRegistryType2.serialize(struct10k))
  .add("serialize - tree - 10k", () => updateValidator(tree10k) && validatorRegistryType2.serialize(tree10k))
// .add("serialize - old - 100k", () => updateValidator(struct100k) && ssz.serialize(validatorRegistryType1, struct100k))
//  .add("serialize - structural - 100k", () => updateValidator(struct100k) && validatorRegistryType2.serialize(struct100k))
//  .add("serialize - tree - 100k", () => updateValidator(tree100k) && validatorRegistryType2.serialize(tree100k))
//  .add("serialize - old - 1m", () => updateValidator(struct1m) && ssz.serialize(validatorRegistryType1, struct1m))
// .add("serialize - structural - 1m", () => updateValidator(struct1m) && validatorRegistryType2.serialize(struct1m))
// .add("serialize - tree - 1m", () => updateValidator(tree1m) && validatorRegistryType2.serialize(tree1m))
//
  .add("hashTreeRoot - old - 10k", () => updateValidator(struct10k) && ssz.hashTreeRoot(validatorRegistryType1, struct10k))
  .add("hashTreeRoot - structural - 10k", () => updateValidator(struct10k) && validatorRegistryType2.hashTreeRoot(struct10k))
  .add("hashTreeRoot - tree - 10k", () => updateValidator(tree10k) && validatorRegistryType2.hashTreeRoot(tree10k))
//  .add("hashTreeRoot - old - 100k", () => updateValidator(struct100k) && ssz.hashTreeRoot(validatorRegistryType1, struct100k))
// .add("hashTreeRoot - structural - 100k", () => updateValidator(struct100k) && validatorRegistryType2.hashTreeRoot(struct100k))
// .add("hashTreeRoot - tree - 100k", () => updateValidator(tree100k) && validatorRegistryType2.hashTreeRoot(tree100k))
// .add("hashTreeRoot - old - 1m", () => updateValidator(struct1m) && ssz.hashTreeRoot(validatorRegistryType1, struct1m))
// .add("hashTreeRoot - structural - 1m", () => updateValidator(struct1m) && validatorRegistryType2.hashTreeRoot(struct1m))
// .add("hashTreeRoot - tree - 1m", () => updateValidator(tree1m) && validatorRegistryType2.hashTreeRoot(tree1m))

  .on('cycle', function(event: any) {
    console.log(String(event.target));
  })
  .run({ 'async': true });
