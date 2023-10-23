import {BasicType} from "@chainsafe/ssz";
import {ValidatorStatus} from "../types.js";

// TODO: add spec reference once defined
const statusToByteMapping: Record<ValidatorStatus, number> = {
  pending_initialized: 0x01,
  pending_queued: 0x02,
  active_ongoing: 0x03,
  active_exiting: 0x04,
  active_slashed: 0x05,
  exited_unslashed: 0x06,
  exited_slashed: 0x07,
  withdrawal_possible: 0x08,
  withdrawal_done: 0x09,
};

const byteToStatusMapping = Object.fromEntries(
  Object.entries(statusToByteMapping).map(([key, value]) => [value, key])
) as Record<number, ValidatorStatus>;

export class ValidatorStatusType extends BasicType<ValidatorStatus> {
  // TODO: review if those parameters are correct
  readonly typeName = "ValidatorStatus";
  readonly byteLength = 1;
  readonly fixedSize = 1;
  readonly minSize = 1;
  readonly maxSize = 1;

  defaultValue(): ValidatorStatus {
    return "" as ValidatorStatus;
  }

  // Serialization + deserialization

  value_serializeToBytes(output: ByteViews, offset: number, value: ValidatorStatus): number {
    output.uint8Array[offset] = statusToByteMapping[value];
    return offset + 1;
  }
  value_deserializeFromBytes(data: ByteViews, start: number, end: number): ValidatorStatus {
    this.assertValidSize(end - start);

    const status = byteToStatusMapping[data.uint8Array[start]];

    if (status === undefined) {
      throw Error(`ValidatorStatus: invalid value: ${data.uint8Array[start]}`);
    }

    return status;
  }
  tree_serializeToBytes(): number {
    throw Error("Not supported in ValidatorStatus type");
  }
  tree_deserializeFromBytes(): never {
    throw Error("Not supported in ValidatorStatus type");
  }

  // Fast tree opts

  tree_getFromNode(): ValidatorStatus {
    throw Error("Not supported in ValidatorStatus type");
  }
  tree_setToNode(): void {
    throw Error("Not supported in ValidatorStatus type");
  }
  tree_getFromPackedNode(): ValidatorStatus {
    throw Error("Not supported in ValidatorStatus type");
  }
  tree_setToPackedNode(): void {
    throw Error("Not supported in ValidatorStatus type");
  }

  // JSON

  fromJson(json: unknown): ValidatorStatus {
    return json as ValidatorStatus;
  }

  toJson(value: ValidatorStatus): ValidatorStatus {
    return value;
  }
}

// TODO: export from ssz / or move type to ssz?
type ByteViews = {
  uint8Array: Uint8Array;
  dataView: DataView;
};

export const validatorStatusType = new ValidatorStatusType();
