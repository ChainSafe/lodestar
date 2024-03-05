# Integration Tests

The following tests are found in `packages/beacon-node`

#### `test:sim:withdrawals`

This test simulates capella blocks with withdrawals. It tests lodestar against Geth and EthereumJS.

There are two ENV variables that are required to run this test:

- `EL_BINARY_DIR`: the docker image setup to handle the test case
- `EL_SCRIPT_DIR`: the script that will be used to start the EL client. All of the scripts can be found in `packages/beacon-node/test/scripts/el-interop` and the `EL_SCRIPT_DIR` is the sub-directory name in that root that should be used to run the test.

The command to run this test is:

`EL_BINARY_DIR=g11tech/geth:withdrawals EL_SCRIPT_DIR=gethdocker yarn vitest --run test/sim/withdrawal-interop.test.ts`

The images used by this test during CI are:

- `GETH_WITHDRAWALS_IMAGE: g11tech/geth:withdrawalsfeb8`
- `ETHEREUMJS_WITHDRAWALS_IMAGE: g11tech/ethereumjs:blobs-b6b63`

#### `test:sim:mergemock`

#### `yarn test:sim:blobs`
