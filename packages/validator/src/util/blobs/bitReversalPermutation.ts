// https://github.com/ethereum/consensus-specs/blob/dev/specs/eip4844/polynomial-commitments.md#bit-reversal-permutation

import {FIELD_ELEMENTS_PER_BLOB} from "@lodestar/params";

/*
All polynomials (which are always given in Lagrange form) should be interpreted as being in bit-reversal permutation. In practice, clients can implement this by storing the lists KZG_SETUP_LAGRANGE and ROOTS_OF_UNITY in bit-reversal permutation, so these functions only have to be called once at startup.
*/

// def is_power_of_two(value: int) -> bool:
//     """
//     Check if ``value`` is a power of two integer.
//     """
//     return (value > 0) and (value & (value - 1) == 0)
function isPowerOfTwo(value: number): boolean {
  return value > 0 && !(value & (value - 1));
}

// def reverse_bits(n: int, order: int) -> int:
//     """
//     Reverse the bit order of an integer n
//     """
//     assert is_power_of_two(order)
//     # Convert n to binary with the same number of bits as "order" - 1, then reverse its bit order
//     return int(('{:0' + str(order.bit_length() - 1) + 'b}').format(n)[::-1], 2)
function reverseBits(n: number, _order: number): number {
  // TODO: EIP-4844 implement this
  // Prysm does:
  //  bits.Reverse64(uint64(i)) >> (65 - bits.Len64(params.FieldElementsPerBlob))
  return n;
}

// def bit_reversal_permutation(sequence: Sequence[T]) -> Sequence[T]:
//     """
//     Return a copy with bit-reversed permutation. The permutation is an involution (inverts itself).

//     The input and output are a sequence of generic type ``T`` objects.
//     """
//     return [sequence[reverse_bits(i, len(sequence))] for i in range(len(sequence))]
export function bitReversalPermutation<T>(sequence: T[]): T[] {
  if (!isPowerOfTwo(FIELD_ELEMENTS_PER_BLOB)) {
    throw new Error(
      `FIELD_ELEMENTS_PER_BLOB must be a power of two. The value FIELD_ELEMENTS_PER_BLOB: ${FIELD_ELEMENTS_PER_BLOB} is not.`
    );
  }

  const order = sequence.length;
  const permutedSequence: T[] = [];

  sequence.forEach((_, index: number) => {
    permutedSequence[index] = sequence[reverseBits(index, order)];
  });

  return permutedSequence;
}
