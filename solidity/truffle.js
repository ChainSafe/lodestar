/*
 * NB: since truffle-hdwallet-provider 0.0.5 you must wrap HDWallet providers in a 
 * function when declaring them. Failure to do so will cause commands to hang. ex:
 * ```
 * mainnet: {
 *     provider: function() { 
 *       return new HDWalletProvider(mnemonic, 'https://mainnet.infura.io/<infura-key>') 
 *     },
 *     network_id: '1',
 *     gas: 4500000,
 *     gasPrice: 10000000000,
 *   },
 */

module.exports = {
  networks: {
  development: {
            //host: "localhost",
            port: 8545,
            host: "127.0.0.1",
            // port: 7545,
            network_id: "0",
            gas: 4600000,
            gasLimit: 10000000
  },
  geth_testnet: {
            host: "127.0.0.1",
            port: 8545,
            // host: "127.0.0.1",
            // port: 7545,
            network_id: "*",
            //from: "0x43EC6d0942f7fAeF069F7F63D0384a27f529B062",
            gas: 580000,
            gasLimit: 10000000
   },
  }
};
