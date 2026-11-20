export const MAX_PAYLOAD_ORDER_IDS = 256;

export type OrderMetadata = {
  version: 1;
  orderIds: readonly string[] | null;
  doNotOfferBefore: number;
};

export function parseOrderMetadata(value: unknown): OrderMetadata | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "object" || value === null) throw Error("ORDER_METADATA_INVALID");
  const record = value as Record<string, unknown>;
  if (
    record.version !== 1 ||
    !Number.isSafeInteger(record.doNotOfferBefore) ||
    (record.doNotOfferBefore as number) < 0 ||
    (record.orderIds !== null &&
      (!Array.isArray(record.orderIds) ||
        record.orderIds.length > MAX_PAYLOAD_ORDER_IDS ||
        record.orderIds.some((id) => typeof id !== "string" || !/^0x[0-9a-f]{64}$/.test(id)) ||
        new Set(record.orderIds).size !== record.orderIds.length))
  )
    throw Error("ORDER_METADATA_INVALID");
  return Object.freeze({
    version: 1,
    orderIds: record.orderIds === null ? null : Object.freeze([...(record.orderIds as string[])].sort()),
    doNotOfferBefore: record.doNotOfferBefore as number,
  });
}

export function sameOrderMetadata(left?: OrderMetadata, right?: OrderMetadata): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function isOrderOfferAllowed(metadata?: OrderMetadata): boolean {
  return metadata === undefined || Date.now() >= metadata.doNotOfferBefore;
}
