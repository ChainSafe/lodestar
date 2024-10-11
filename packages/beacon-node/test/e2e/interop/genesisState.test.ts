import {describe, it, expect} from "vitest";
import {toHexString} from "@chainsafe/ssz";
import {config} from "@lodestar/config/default";
import {ssz} from "@lodestar/types";
import {initDevState} from "../../../src/node/utils/state.js";
import {interopDeposits} from "../../../src/node/utils/interop/deposits.js";

describe("interop / initDevState", () => {
  it("Create interop deposits", () => {
    const deposits = interopDeposits(config, ssz.phase0.DepositDataRootList.defaultViewDU(), 1);

    expect(deposits.map((deposit) => ssz.phase0.Deposit.toJson(deposit))).toEqual([
      {
        proof: [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          "0xf5a5fd42d16a20302798ef6ed309979b43003d2320d9f0e8ea9831a92759fb4b",
          "0xdb56114e00fdd4c1f85c892bf35ac9a89289aaecb1ebd0a96cde606a748b5d71",
          "0xc78009fdf07fc56a11f122370658a353aaa542ed63e44c4bc15ff4cd105ab33c",
          "0x536d98837f2dd165a55d5eeae91485954472d56f246df256bf3cae19352a123c",
          "0x9efde052aa15429fae05bad4d0b1d7c64da64d03d7a1854a588c2cb8430c0d30",
          "0xd88ddfeed400a8755596b21942c1497e114c302e6118290f91e6772976041fa1",
          "0x87eb0ddba57e35f6d286673802a4af5975e22506c7cf4c64bb6be5ee11527f2c",
          "0x26846476fd5fc54a5d43385167c95144f2643f533cc85bb9d16b782f8d7db193",
          "0x506d86582d252405b840018792cad2bf1259f1ef5aa5f887e13cb2f0094f51e1",
          "0xffff0ad7e659772f9534c195c815efc4014ef1e1daed4404c06385d11192e92b",
          "0x6cf04127db05441cd833107a52be852868890e4317e6a02ab47683aa75964220",
          "0xb7d05f875f140027ef5118a2247bbb84ce8f2f0f1123623085daf7960c329f5f",
          "0xdf6af5f5bbdb6be9ef8aa618e4bf8073960867171e29676f8b284dea6a08a85e",
          "0xb58d900f5e182e3c50ef74969ea16c7726c549757cc23523c369587da7293784",
          "0xd49a7502ffcfb0340b1d7885688500ca308161a7f96b62df9d083b71fcc8f2bb",
          "0x8fe6b1689256c0d385f42f5bbe2027a22c1996e110ba97c171d3e5948de92beb",
          "0x8d0d63c39ebade8509e0ae3c9c3876fb5fa112be18f905ecacfecb92057603ab",
          "0x95eec8b2e541cad4e91de38385f2e046619f54496c2382cb6cacd5b98c26f5a4",
          "0xf893e908917775b62bff23294dbbe3a1cd8e6cc1c35b4801887b646a6f81f17f",
          "0xcddba7b592e3133393c16194fac7431abf2f5485ed711db282183c819e08ebaa",
          "0x8a8d7fe3af8caa085a7639a832001457dfb9128a8061142ad0335629ff23ff9c",
          "0xfeb3c337d7a51a6fbf00b9e34c52e1c9195c969bd4e7a0bfd51d5c5bed9c1167",
          "0xe71f0aa83cc32edfbefa9f4d3e0174ca85182eec9f3a09f6a6c0df6377a510d7",
          "0x31206fa80a50bb6abe29085058f16212212a60eec8f049fecb92d8c8e0a84bc0",
          "0x21352bfecbeddde993839f614c3dac0a3ee37543f9b412b16199dc158e23b544",
          "0x619e312724bb6d7c3153ed9de791d764a366b389af13c58bf8a8d90481a46765",
          "0x7cdd2986268250628d0c10e385c58c6191e6fbe05191bcc04f133f2cea72c1c4",
          "0x848930bd7ba8cac54661072113fb278869e07bb8587f91392933374d017bcbe1",
          "0x8869ff2c22b28cc10510d9853292803328be4fb0e80495e8bb8d271f5b889636",
          "0xb5fe28e79f1b850f8658246ce9b6a1e7b49fc06db7143e8fe0b4f2b0c5523a5c",
          "0x985e929f70af28d0bdd1a90a808f977f597c7c778c489e98d3bd8910d31ac0f7",
          "0x0100000000000000000000000000000000000000000000000000000000000000",
        ],
        data: {
          pubkey: "0xa99a76ed7796f7be22d5b7e85deeb7c5677e88e511e0b337618f8c4eb61349b4bf2d153f649f7b53359fe8b94a38e44c",
          withdrawal_credentials: "0x00fad2a6bfb0e7f1f0f45460944fbd8dfa7f37da06a4d13b3983cc90bb46963b",
          amount: "32000000000",
          signature:
            "0xa95af8ff0f8c06af4d29aef05ce865f85f82df42b606008ec5b1bcb42b17ae47f4b78cdce1db31ce32d18f42a6b296b4014a2164981780e56b5a40d7723c27b8423173e58fa36f075078b177634f66351412b867c103f532aedd50bcd9b98446",
        },
      },
    ]);
  });

  it("Create correct genesisState", () => {
    const validatorCount = 8;
    const {state} = initDevState(config, validatorCount, {
      genesisTime: 1644000000,
      eth1BlockHash: Buffer.alloc(32, 0xaa),
      eth1Timestamp: 1644000000,
    });

    expect(toHexString(state.hashTreeRoot())).toBe(
      "0x3ef3bda2cee48ebdbb6f7a478046631bad3b5eeda3543e55d9dd39da230425bb"
    );
  });
});
