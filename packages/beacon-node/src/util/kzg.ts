// "c-kzg" has hardcoded the mainnet value, do not use params
export const FIELD_ELEMENTS_PER_BLOB_MAINNET = 4096;

import {DasContextJs} from "@crate-crypto/node-eth-kzg";

export const kzg = DasContextJs.create({usePrecomp: true});
