import {BlsImplementation, getBlsImplementation} from "./implementation.js";

export {BlsImplementation};

export interface PublicKey {
  toBytes(compress?: boolean): Uint8Array;
  toHex(compress?: boolean): string;
}

interface PublicKeyConstructor {
  readonly COMPRESS_SIZE: number;
  readonly SERIALIZE_SIZE: number;
  fromBytes(bytes: Uint8Array, validate?: boolean | null): PublicKey;
  fromHex(hex: string, validate?: boolean | null): PublicKey;
}

export interface Signature {
  toBytes(compress?: boolean): Uint8Array;
  toHex(compress?: boolean): string;
}

interface SignatureConstructor {
  readonly COMPRESS_SIZE: number;
  readonly SERIALIZE_SIZE: number;
  fromBytes(bytes: Uint8Array, validate?: boolean | null, infinityCheck?: boolean | null): Signature;
  fromHex(hex: string, validate?: boolean | null, infinityCheck?: boolean | null): Signature;
}

export interface SecretKey {
  sign(message: Uint8Array): Signature;
  toPublicKey(): PublicKey;
  toBytes(): Uint8Array;
  toHex(): string;
}

interface SecretKeyConstructor {
  fromBytes(bytes: Uint8Array): SecretKey;
  fromHex(hex: string): SecretKey;
  fromKeygen(ikm: Uint8Array, keyInfo?: Uint8Array | null): SecretKey;
}

export interface SignatureSet {
  msg: Uint8Array;
  pk: PublicKey;
  sig: Signature;
}

export interface PkAndSerializedSig {
  pk: PublicKey;
  sig: Uint8Array;
}

export interface PkAndSig {
  pk: PublicKey;
  sig: Signature;
}

interface BlsModule {
  PublicKey: PublicKeyConstructor;
  SecretKey: SecretKeyConstructor;
  Signature: SignatureConstructor;
  aggregatePublicKeys(publicKeys: PublicKey[], validate?: boolean | null): PublicKey;
  aggregateSerializedPublicKeys(publicKeys: Uint8Array[], validate?: boolean | null): PublicKey;
  aggregateSignatures(signatures: Signature[], groupCheck?: boolean | null): Signature;
  aggregateVerify(
    messages: Uint8Array[],
    publicKeys: PublicKey[],
    signature: Signature,
    validate?: boolean | null,
    groupCheck?: boolean | null
  ): boolean;
  aggregateWithRandomness(sets: PkAndSerializedSig[]): PkAndSig;
  asyncAggregateWithRandomness(sets: PkAndSerializedSig[]): Promise<PkAndSig>;
  fastAggregateVerify(
    message: Uint8Array,
    publicKeys: PublicKey[],
    signature: Signature,
    groupCheck?: boolean | null
  ): boolean;
  verify(
    message: Uint8Array,
    publicKey: PublicKey,
    signature: Signature,
    validate?: boolean | null,
    groupCheck?: boolean | null
  ): boolean;
  verifyMultipleAggregateSignatures(
    sets: SignatureSet[],
    validate?: boolean | null,
    groupCheck?: boolean | null
  ): boolean;
}

export interface PubkeyCache {
  get(index: number): PublicKey | undefined;
  getOrThrow(index: number): PublicKey;
  aggregate(indices: number[]): PublicKey;
  getIndex(pubkey: Uint8Array): number | null;
  set(index: number, pubkey: Uint8Array): void;
  readonly size: number;
  reset(): void;
  ensureCapacity(capacity: number): void;
}

const blsImplementation = getBlsImplementation();
export const ACTIVE_BLS_IMPLEMENTATION = blsImplementation;

let bls: BlsModule;
let createSelectedPubkeyCache: () => PubkeyCache;

if (blsImplementation === BlsImplementation.lodestarZ) {
  const [blsModule, pubkeyModule] = await Promise.all([
    import("@chainsafe/lodestar-z/blst"),
    import("@chainsafe/lodestar-z/pubkeys"),
  ]);
  bls = blsModule as unknown as BlsModule;
  createSelectedPubkeyCache = () => pubkeyModule.pubkeyCache as PubkeyCache;
} else {
  const [blsModule, pubkeyModule] = await Promise.all([import("@chainsafe/blst"), import("../cache/pubkeyCache.js")]);

  bls = {
    ...(blsModule as unknown as BlsModule),
    PublicKey: Object.assign(blsModule.PublicKey, {
      COMPRESS_SIZE: blsModule.PUBLIC_KEY_LENGTH_COMPRESSED,
      SERIALIZE_SIZE: blsModule.PUBLIC_KEY_LENGTH_UNCOMPRESSED,
    }),
    Signature: Object.assign(blsModule.Signature, {
      COMPRESS_SIZE: blsModule.SIGNATURE_LENGTH_COMPRESSED,
      SERIALIZE_SIZE: blsModule.SIGNATURE_LENGTH_UNCOMPRESSED,
    }),
  };
  createSelectedPubkeyCache = pubkeyModule.createStandardPubkeyCache;
}

export const PublicKey = bls.PublicKey;
export const SecretKey = bls.SecretKey;
export const Signature = bls.Signature;
export const aggregatePublicKeys = bls.aggregatePublicKeys;
export const aggregateSerializedPublicKeys = bls.aggregateSerializedPublicKeys;
export const aggregateSignatures = bls.aggregateSignatures;
export const aggregateVerify = bls.aggregateVerify;
export const aggregateWithRandomness = bls.aggregateWithRandomness;
export const asyncAggregateWithRandomness = bls.asyncAggregateWithRandomness;
export const fastAggregateVerify = bls.fastAggregateVerify;
export const verify = bls.verify;
export const verifyMultipleAggregateSignatures = bls.verifyMultipleAggregateSignatures;

export const pubkeyCache = createSelectedPubkeyCache();

/** Create an isolated cache with blst, or return the process-wide native cache with lodestar-z. */
export function createPubkeyCache(): PubkeyCache {
  return blsImplementation === BlsImplementation.lodestarZ ? pubkeyCache : createSelectedPubkeyCache();
}
