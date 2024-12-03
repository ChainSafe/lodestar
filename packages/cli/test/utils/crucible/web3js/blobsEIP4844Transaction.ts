import {RLP} from "@ethereumjs/rlp";
import {fromHex} from "@lodestar/utils";
import {keccak256} from "ethereum-cryptography/keccak.js";
import {
  FeeMarketEIP1559Transaction,
  FeeMarketEIP1559TxData,
  TxOptions,
  bigIntToUnpaddedUint8Array,
  uint8ArrayToBigInt,
} from "web3-eth-accounts";

function uint8ArrayConcat(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((acc, arr) => acc + arr.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

const BLOBS_TX_TYPE = "0x03";
const BLOBS_TX_TYPE_BYTES = fromHex(BLOBS_TX_TYPE);

interface BlobsEIP2718TransactionData extends FeeMarketEIP1559TxData {
  maxFeePerBlobGas: string;
  blobVersionedHashes: string[];
  blobs: string[];
  kzgCommitments: string[];
  kzgProofs: string[];
}

interface BlobsEIP2718TransactionOptions extends FeeMarketEIP1559TxData {
  maxFeePerBlobGas: bigint;
  blobVersionedHashes: Uint8Array[];
  blobs: Uint8Array[];
  kzgCommitments: Uint8Array[];
  kzgProofs: Uint8Array[];
}

export class BlobsEIP4844Transaction extends FeeMarketEIP1559Transaction {
  readonly maxFeePerBlobGas: bigint;
  readonly blobVersionedHashes: Uint8Array[];
  readonly blobs: Uint8Array[];
  readonly kzgCommitments: Uint8Array[];
  readonly kzgProofs: Uint8Array[];

  constructor(data: BlobsEIP2718TransactionOptions, opts: TxOptions = {}) {
    super({...data, type: BLOBS_TX_TYPE}, {...opts, freeze: false});

    if (!this.to) {
      throw new Error("For BlobsEIP2718Transaction the field 'to' is required");
    }

    if (!data.maxFeePerBlobGas) {
      throw new Error("For BlobsEIP2718Transaction the field 'maxFeePerBlobGas' is required");
    }

    if (data.blobVersionedHashes === undefined) {
      throw new Error("For BlobsEIP2718Transaction the field 'blobVersionedHashes' is required");
    }

    this.maxFeePerBlobGas = data.maxFeePerBlobGas;
    this.blobVersionedHashes = data.blobVersionedHashes;
    this.blobs = data.blobs;
    this.kzgCommitments = data.kzgCommitments;
    this.kzgProofs = data.kzgProofs;
  }

  static fromTxData(txData: BlobsEIP2718TransactionData, opts: TxOptions = {}): BlobsEIP4844Transaction {
    return new BlobsEIP4844Transaction(
      {
        ...txData,
        maxFeePerBlobGas: uint8ArrayToBigInt(fromHex(txData.maxFeePerBlobGas)),
        blobVersionedHashes: txData.blobVersionedHashes.map(fromHex),
        blobs: txData.blobs.map(fromHex),
        kzgCommitments: txData.kzgCommitments.map(fromHex),
        kzgProofs: txData.kzgProofs.map(fromHex),
      },
      opts
    );
  }

  // @ts-expect-error Return type of parent class is not compatible with this class
  raw(): [
    Uint8Array, // chain_id,
    Uint8Array, // nonce,
    Uint8Array, // max_priority_fee_per_gas,
    Uint8Array, // max_fee_per_gas,
    Uint8Array, // gas_limit,
    Uint8Array, // to,
    Uint8Array, // value,
    Uint8Array, // data,
    [Uint8Array, Uint8Array[]][], // access_list,
    Uint8Array, // max_fee_per_blob_gas,
    Uint8Array[], // blob_versioned_hashes,
    Uint8Array, // y_parity,
    Uint8Array, // r,
    Uint8Array, // s]
  ] {
    return [
      bigIntToUnpaddedUint8Array(this.chainId),
      bigIntToUnpaddedUint8Array(this.nonce),
      bigIntToUnpaddedUint8Array(this.maxPriorityFeePerGas),
      bigIntToUnpaddedUint8Array(this.maxFeePerGas),
      bigIntToUnpaddedUint8Array(this.gasLimit),
      this.to !== undefined ? this.to.buf : Uint8Array.from([]),
      bigIntToUnpaddedUint8Array(this.value),
      this.data,
      this.accessList,
      bigIntToUnpaddedUint8Array(this.maxFeePerBlobGas),
      this.blobVersionedHashes,
      this.v !== undefined ? bigIntToUnpaddedUint8Array(this.v) : Uint8Array.from([]),
      this.r !== undefined ? bigIntToUnpaddedUint8Array(this.r) : Uint8Array.from([]),
      this.s !== undefined ? bigIntToUnpaddedUint8Array(this.s) : Uint8Array.from([]),
    ];
  }

  getMessageToSign(hashMessage = true): Uint8Array {
    const base = this.raw().slice(0, 11);
    const message = uint8ArrayConcat(BLOBS_TX_TYPE_BYTES, RLP.encode(base));
    if (hashMessage) {
      return keccak256(message);
    }
    return message;
  }

  serialize(): Uint8Array {
    const base = this.raw();
    return uint8ArrayConcat(BLOBS_TX_TYPE_BYTES, RLP.encode([base, this.blobs, this.kzgCommitments, this.kzgProofs]));
  }

  // @ts-expect-error Return type of parent class is not compatible with this class
  _processSignature(v: bigint, r: Uint8Array, s: Uint8Array): BlobsEIP4844Transaction {
    return new BlobsEIP4844Transaction(
      {
        chainId: this.chainId,
        nonce: this.nonce,
        maxPriorityFeePerGas: this.maxPriorityFeePerGas,
        maxFeePerGas: this.maxFeePerGas,
        gasLimit: this.gasLimit,
        to: this.to,
        value: this.value,
        data: this.data,
        accessList: this.accessList,
        maxFeePerBlobGas: this.maxFeePerBlobGas,
        blobVersionedHashes: this.blobVersionedHashes,
        blobs: this.blobs,
        kzgCommitments: this.kzgCommitments,
        kzgProofs: this.kzgProofs,
        v: v - BigInt(27), // This looks extremely hacky: /util actually adds 27 to the value, the recovery bit is either 0 or 1.,
        r,
        s,
      },
      this.txOptions
    );
  }
}
