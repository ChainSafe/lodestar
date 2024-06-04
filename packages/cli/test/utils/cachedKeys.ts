// // Uncomment code below to re-generate the keys
// import bls from "@chainsafe/bls";
// const sks: string[] = [];
// const pks: string[] = [];
// for (let i = 0; i < 4; i++) {
//   const sk = bls.SecretKey.fromKeygen(Buffer.alloc(32, 0xaa + i));
//   sks.push(sk.toHex());
//   pks.push(sk.toPublicKey().toHex());
// }
// console.log(`
// export const cachedPubkeysHex = ${JSON.stringify(pks)}
// export const cachedSeckeysHex = ${JSON.stringify(sks)}
// `);

export const cachedPubkeysHex = [
  "0x8be678633e927aa0435addad5dcd5283fef6110d91362519cd6d43e61f6c017d724fa579cc4b2972134e050b6ba120c0",
  "0x8e602f8ec17777c22f465f9b4707c2840647790f15f5c33bd8850f274d5c320850105639960ae4effe57aa5dd279bb98",
  "0x832a777fe5d89724583bcce5b4794d0b38be419a2daed09d7ee6af2c7c09465e0e2cd07a305c38e59e83e211e8ded246",
  "0x8076b9d469d71902e06cce3af0528c190850d3dabfb8314eba1ef4eb789131de0dd75d2fe4b7964f347bfe61597cde54",
];
export const cachedSeckeysHex = [
  "0x0e5bd52621b6a8956086dcf0ecc89f0cdca56cebb2a8516c2d4252a9867fc551",
  "0x19773a731561958a4f257b85af81769bcb1146476936c4d9add796d4d3fda020",
  "0x6c9e69a6781538c945ead231aecbec9cf6ca3500df59bc85f711fc97a768694e",
  "0x2948f046357e74993187a6ef40acb961911c52ac7a4257babe6af197f447e892",
];
