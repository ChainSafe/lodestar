import {BooleanType, ByteVectorType, UintBigintType, UintNumberType} from "@chainsafe/ssz";
import {ExecutionAddressType} from "../utils/executionAddress.js";

// biome-ignore lint/suspicious/noShadowRestrictedNames: We explicitly want this name for variable
export const Boolean = new BooleanType();
export const Byte = new UintNumberType(1);
export const Bytes4 = new ByteVectorType(4);
export const Bytes8 = new ByteVectorType(8);
export const Bytes20 = new ByteVectorType(20);
export const Bytes32 = new ByteVectorType(32);
export const Bytes48 = new ByteVectorType(48);
export const Bytes96 = new ByteVectorType(96);
export const Uint8 = new UintNumberType(1);
export const Uint16 = new UintNumberType(2);
export const Uint32 = new UintNumberType(4);
/**
 * A JS `number` is an IEEE-754 double which has 53 bits integer precision. This implies that it can store
 * a value up to 2^53-1 without losing any precision (`Number.MAX_SAFE_INTEGER` represents that exact limit).
 * So it can't store a 64 bit integer with precision in the higher bits.
 *
 * However, JS `bigint` arithmetics is ~100x slower than `number`.
 * Therefor, this type uses `number` for 64 bits values, for use in well-analyzed cases where
 * the value is known to never cross the `Number.MAX_SAFE_INTEGER` limit.
 *
 * Caution and reasoned analysis are always required before using this type as the consequence of misuse is a consensus split.
 */
export const UintNum64 = new UintNumberType(8);
export const UintNumInf64 = new UintNumberType(8, {clipInfinity: true});
export const UintBn64 = new UintBigintType(8);
export const UintBn128 = new UintBigintType(16);
export const UintBn256 = new UintBigintType(32);

// Custom types, defined for type hinting and readability

/**
 * Use JS Number for performance, values must be limited to 2**52-1.
 * Slot is a time unit, so in all usages it's bounded by the clock, ensuring < 2**53-1
 */
export const Slot = UintNum64;
/**
 * Use JS Number for performance, values must be limited to 2**52-1.
 * Epoch is a time unit, so in all usages it's bounded by the clock, ensuring < 2**53-1
 */
export const Epoch = UintNum64;
/** Same as @see Epoch + some validator properties must represent 2**52-1 also, which we map to `Infinity` */
export const EpochInf = UintNumInf64;
/**
 * Use JS Number for performance, values must be limited to 2**52-1.
 * SyncPeriod is a time unit, so in all usages it's bounded by the clock, ensuring < 2**53-1
 */
export const SyncPeriod = UintNum64;
/**
 * Use JS Number for performance, values must be limited to 2**52-1.
 * CommitteeIndex is bounded by the max possible number of committees which is bounded by `VALIDATOR_REGISTRY_LIMIT`
 */
export const CommitteeIndex = UintNum64;
/** @see CommitteeIndex */
export const SubcommitteeIndex = UintNum64;
/**
 * Use JS Number for performance, values must be limited to 2**52-1.
 * ValidatorIndex is bounded by `VALIDATOR_REGISTRY_LIMIT`
 */
export const ValidatorIndex = UintNum64;
export const WithdrawalIndex = UintNum64;
export const DepositIndex = UintBn64;
export const Gwei = UintBn64;
export const Wei = UintBn256;
export const Root = new ByteVectorType(32);
export const BlobIndex = UintNum64;

export const Version = Bytes4;
export const DomainType = Bytes4;
export const ForkDigest = Bytes4;
export const BLSPubkey = Bytes48;
export const BLSSignature = Bytes96;
export const Domain = Bytes32;
export const ParticipationFlags = new UintNumberType(1, {setBitwiseOR: true});
export const ExecutionAddress = new ExecutionAddressType();
export const ColumnIndex = UintNum64;
export const CustodyIndex = UintNum64;
export const RowIndex = UintNum64;
