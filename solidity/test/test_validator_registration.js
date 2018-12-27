//Lodestar Chain
//Copyright (C) 2018 ChainSafe Systems

// This program is free software: you can redistribute it and/or modify
// it under the terms of the GNU General Public License as published by
// the Free Software Foundation, either version 3 of the License, or
// (at your option) any later version.
//
// This program is distributed in the hope that it will be useful,
// but WITHOUT ANY WARRANTY; without even the implied warranty of
// MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
// GNU General Public License for more details.
//
// You should have received a copy of the GNU General Public License
// along with this program.  If not, see <http://www.gnu.org/licenses/>.

var ValidatorRegistration = artifacts.require('ValidatorRegistration');

function watchEvents(contract) {
    var events = contract.allEvents({fromBlock: 0, toBlock: 'latest'});

    console.log("contract events:\n");
    events.watch(function(error, result){
        console.log(result);
    });
}

contract('ValidatorRegistration', function(accounts) {

  var addressA = web3.eth.accounts[0];
  var addressB = web3.eth.accounts[1];
  var addressC = web3.eth.accounts[2];
  var addressD = web3.eth.accounts[3];

  web3.eth.defaultAccount = web3.eth.accounts[0];

  var validatorRegistration;

  it('should initialize a ValidatorRegistration contract', async() => {
    validatorRegistration = await ValidatorRegistration.new();

    assert(validatorRegistration !== undefined, "ValidatorRegistration contract has not been instantiated");
  });

  it('should successfully make a deposit and emit an event', async() => {
    var events = validatorRegistration.allEvents({fromBlock: 0, toBlock: 'latest'});

    events.watch(function(error, result) {
        console.log(result);
    });

    let blockHeader = await web3.eth.getBlock('latest');

    let depositHash = await validatorRegistration.deposit(addressA, 43, addressB, addressA, {from: addressA, value: web3.toWei(32, "ether")});
    let depositRes = await validatorRegistration.deposit.call(addressA, 43, addressB, addressA, {from: addressA, value: web3.toWei(32, "ether")});

    let depositReceipt = await web3.eth.getTransactionReceipt(depositHash.receipt.transactionHash);
    console.log(depositReceipt);



  });

});
