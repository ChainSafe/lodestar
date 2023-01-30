import {fromHex} from "@lodestar/utils";
import {verifyKzgCommitmentsAgainstTransactions} from "../../../src/index.js";

// Data from fee-merket test at Inphi/eip4844-interop
// Ref https://github.com/Inphi/eip4844-interop/blob/cad0dab50901cc1371a683388136fd56654d3bba/tests/fee-market/main.go#L67
const tx =
  "05450000000058aca83353114c8385ece4c18461dbb8d1ef7479c3640e812acd2ec488c56fcf43e305a508bc30bec9bff27ab367a1ed0b397b0299bb7f48b72884f5178e7c0a0100000000000000000000000000000000000000000000000000000000000000000000000000000000f2052a0100000000000000000000000000000000000000000000000000000000f2052a010000000000000000000000000000000000000000000000000000005034030000000000c00000004e61bc0000000000000000000000000000000000000000000000000000000000d5000000d5000000005ed0b200000000000000000000000000000000000000000000000000000000d500000001ffb38a7a99e3e2335be83fc74b7faa19d553124301134066927e042d676d93e523ef251e0b82bdcb72d2ca85e99c804f60ffa989";
const blobKzgCommitment =
  "a1a6202ee4a387c16ba23379b9c471a0cc48cb53793678faa92b2920c270867eebeac74351946859ffd199c6fe32385e";

describe("blobs", () => {
  it("verifyKzgCommitmentsAgainstTransactions", () => {
    verifyKzgCommitmentsAgainstTransactions([fromHex(tx)], [fromHex(blobKzgCommitment)]);
  });

  // 05
  // 45000000
  // 0058aca83353114c8385ece4c18461dbb8d1ef7479c3640e812acd2ec488c56fcf43e305a508bc30bec9bff27ab367a1ed0b397b0299bb7f48b72884f5178e7c0a
  // 000 - 0100000000000000000000000000000000000000000000000000000000000000 // chain_id
  // 032 - 0000000000000000                                                 // nonce
  // 040 - 00f2052a01000000000000000000000000000000000000000000000000000000 // max_priority_fee_per_gas
  // 072 - 00f2052a01000000000000000000000000000000000000000000000000000000 // max_fee_per_gas
  // 104 - 5034030000000000                                                 // gas
  // 112 - c0000000                                                         // to - offset_value = 192
  // 116 - 4e61bc0000000000000000000000000000000000000000000000000000000000 // value
  // 148 - d5000000                                                         // data
  // 152 - d5000000                                                         // access_list
  // 156 - 005ed0b200000000000000000000000000000000000000000000000000000000 // max_fee_per_data_gas
  // 188 - d5000000                                                         // blob_versioned_hashes - offset_value = 213
  // 192 - 01 ffb38a7a99e3e2335be83fc74b7faa19d5531243                      // __value_of to
  // 213 - 01134066927e042d676d93e523ef251e0b82bdcb72d2ca85e99c804f60ffa989 // __value_of blob_versioned_hashes
  //
  // field offset: 32 + 8 + 32 + 32 + 8 + 4 + 32 + 4 + 4 + 32 = 188

  // class SignedBlobTransaction(Container):
  //   message: BlobTransaction // 4 bytes offset, continues on 69
  //   signature: ECDSASignature // 65 bytes

  // class BlobTransaction(Container):
  //   chain_id: uint256 // 32 bytes
  //   nonce: uint64 // 8 bytes
  //   max_priority_fee_per_gas: uint256 // 32 bytes
  //   max_fee_per_gas: uint256 // 32 bytes
  //   gas: uint64 // 8 bytes
  //   to: Union[None, Address] # Address = Bytes20 // 4 bytes offset
  //   value: uint256 // 32 bytes
  //   data: ByteList[MAX_CALLDATA_SIZE] // 4 bytes offset
  //   access_list: List[AccessTuple, MAX_ACCESS_LIST_SIZE] // 4 bytes offset
  //   max_fee_per_data_gas: uint256  # new in PR 5707, a.k.a. fee market change of Deneb // 32 bytes offset
  //   blob_versioned_hashes: List[VersionedHash, MAX_VERSIONED_HASHES_LIST_SIZE] // 4 bytes offset

  // field_offset = 32 + 8 + 32 + 32 + 8 + 4 + 32 + 4 + 4 + 32 = 188
});
