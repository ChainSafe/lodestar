import {CompositeTypeAny, CompositeViewDU, ContainerType, Type} from "@chainsafe/ssz";
type BytesRange = {start: number; end: number};

/**
 * Deserialize a state from bytes ignoring some fields.
 */
export function deserializeContainerIgnoreFields<Fields extends Record<string, Type<unknown>>>(
  sszType: ContainerType<Fields>,
  bytes: Uint8Array,
  ignoreFields: (keyof Fields)[],
  fieldRanges?: BytesRange[]
): CompositeViewDU<typeof sszType> {
  const allFields = Object.keys(sszType.fields);
  const object = sszType.defaultViewDU();
  if (!fieldRanges) {
    const dataView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    fieldRanges = sszType.getFieldRanges(dataView, 0, bytes.length);
  }

  for (const [field, type] of Object.entries(sszType.fields)) {
    // loaded above
    if (ignoreFields.includes(field)) {
      continue;
    }
    const fieldIndex = allFields.indexOf(field);
    const fieldRange = fieldRanges[fieldIndex];
    if (type.isBasic) {
      object[field as keyof Fields] = type.deserialize(bytes.subarray(fieldRange.start, fieldRange.end)) as never;
    } else {
      object[field as keyof Fields] = (type as CompositeTypeAny).deserializeToViewDU(
        bytes.subarray(fieldRange.start, fieldRange.end)
      ) as never;
    }
  }

  return object;
}
