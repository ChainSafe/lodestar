export function copyFromBuf64LE(sbuffer: Buffer, tbuffer: Buffer, length: number): void {
  //unrolled fast copy
  switch (length) {
    case 8:
      tbuffer[7] = sbuffer[7];
    /* falls through */
    case 7:
      tbuffer[6] = sbuffer[6];
    /* falls through */
    case 6:
      tbuffer[5] = sbuffer[5];
    /* falls through */
    case 5:
      tbuffer[4] = sbuffer[4];
    /* falls through */
    case 4:
      tbuffer[3] = sbuffer[3];
    /* falls through */
    case 3:
      tbuffer[2] = sbuffer[2];
    /* falls through */
    case 2:
      tbuffer[1] = sbuffer[1];
    /* falls through */
    case 1:
      tbuffer[0] = sbuffer[0];
      break;
    default:
  }
}

export function copyFromBuf64BE(sbuffer: Buffer, tbuffer: Buffer, length: number): void {
  switch (
    length //we need to unroll it for fast computation, buffer copy/looping takes too much time
  ) {
    case 8:
      tbuffer[0] = sbuffer[0]; //length is 8 here
    /* falls through */
    case 7:
      tbuffer[length - 7] = sbuffer[1];
    /* falls through */
    case 6:
      tbuffer[length - 6] = sbuffer[2];
    /* falls through */
    case 5:
      tbuffer[length - 5] = sbuffer[3];
    /* falls through */
    case 4:
      tbuffer[length - 4] = sbuffer[4];
    /* falls through */
    case 3:
      tbuffer[length - 3] = sbuffer[5];
    /* falls through */
    case 2:
      tbuffer[length - 2] = sbuffer[6];
    /* falls through */
    case 1:
      tbuffer[length - 1] = sbuffer[7];
      break;
    default:
  }
}

export function copyToBuf64LE(sbuffer: Uint8Array, tbuffer: Buffer, length: number): void {
  switch (
    length //we need to unroll it for fast computation, buffer copy/looping takes too much time
  ) {
    case 8:
      tbuffer[7] = sbuffer[7];
    /* falls through */
    case 7:
      tbuffer[6] = sbuffer[6];
    /* falls through */
    case 6:
      tbuffer[5] = sbuffer[5];
    /* falls through */
    case 5:
      tbuffer[4] = sbuffer[4];
    /* falls through */
    case 4:
      tbuffer[3] = sbuffer[3];
    /* falls through */
    case 3:
      tbuffer[2] = sbuffer[2];
    /* falls through */
    case 2:
      tbuffer[1] = sbuffer[1];
    /* falls through */
    case 1:
      tbuffer[0] = sbuffer[0];
      break;
    default:
  }
  switch (
    length //zero the rest
  ) {
    case 1:
      tbuffer[1] = 0;
    /* falls through */
    case 2:
      tbuffer[2] = 0;
    /* falls through */
    case 3:
      tbuffer[3] = 0;
    /* falls through */
    case 4:
      tbuffer[4] = 0;
    /* falls through */
    case 5:
      tbuffer[5] = 0;
    /* falls through */
    case 6:
      tbuffer[6] = 0;
    /* falls through */
    case 7:
      tbuffer[7] = 0;
      break;
    default:
  }
}

export function copyToBuf64BE(sbuffer: Uint8Array, tbuffer: Buffer, length: number): void {
  switch (
    length //we need to unroll it for fast computation, buffer copy/looping takes too much time
  ) {
    case 8:
      tbuffer[0] = sbuffer[0];
    /* falls through */
    case 7:
      tbuffer[1] = sbuffer[length - 7];
    /* falls through */
    case 6:
      tbuffer[2] = sbuffer[length - 6];
    /* falls through */
    case 5:
      tbuffer[3] = sbuffer[length - 5];
    /* falls through */
    case 4:
      tbuffer[4] = sbuffer[length - 4];
    /* falls through */
    case 3:
      tbuffer[5] = sbuffer[length - 3];
    /* falls through */
    case 2:
      tbuffer[6] = sbuffer[length - 2];
    /* falls through */
    case 1:
      tbuffer[7] = sbuffer[length - 1];
      break;
    default:
  }
  switch (
    length //zero the rest
  ) {
    case 1:
      tbuffer[6] = 0;
    /* falls through */
    case 2:
      tbuffer[5] = 0;
    /* falls through */
    case 3:
      tbuffer[4] = 0;
    /* falls through */
    case 4:
      tbuffer[3] = 0;
    /* falls through */
    case 5:
      tbuffer[2] = 0;
    /* falls through */
    case 6:
      tbuffer[1] = 0;
    /* falls through */
    case 7:
      tbuffer[0] = 0;
      break;
    default:
  }
}
