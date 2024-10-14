// Buckets are separate database namespaces
export enum Bucket {
  // validator
  // validator = 16, // DEPRECATED on v0.11.0
  // lastProposedBlock = 17, // DEPRECATED on v0.11.0
  // proposedAttestations = 18, // DEPRECATED on v0.11.0
  // validator slashing protection
  slashingProtectionBlockBySlot = 20,
  slashingProtectionAttestationByTarget = 21,
  slashingProtectionAttestationLowerBound = 22,
  slashingProtectionMinSpanDistance = 23,
  slashingProtectionMaxSpanDistance = 24,
  // allForks_pendingBlock = 25, // Root -> SignedBeaconBlock // DEPRECATED on v0.30.0

  validator_metaData = 41,
}

export function getBucketNameByValue<T extends Bucket>(enumValue: T): keyof typeof Bucket {
  const keys = Object.keys(Bucket).filter((x) => {
    if (Number.isNaN(parseInt(x))) {
      return Bucket[x as keyof typeof Bucket] === enumValue;
    }

    return false;
  }) as (keyof typeof Bucket)[];
  if (keys.length > 0) {
    return keys[0];
  }
  throw new Error("Missing bucket for value " + enumValue);
}
