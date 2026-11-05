// SPDX-License-Identifier: MIT
pragma solidity 0.8.30;

interface IDepositContract {
    function deposit(bytes calldata pubkey, bytes calldata credentials, bytes calldata signature, bytes32 root)
        external payable;
}

contract InterleavedDeposit {
    struct Deposit {
        bytes pubkey;
        bytes credentials;
        bytes signature;
        bytes32 root;
        uint256 amount;
    }

    IDepositContract public immutable depositContract;

    constructor(address target) {
        depositContract = IDepositContract(target);
    }

    function submit(Deposit[] calldata deposits) external payable {
        require(deposits.length > 0 && deposits.length <= 120, "batch size");
        uint256 total;
        for (uint256 i; i < deposits.length; ++i) {
            Deposit calldata d = deposits[i];
            total += d.amount;
            depositContract.deposit{value: d.amount}(d.pubkey, d.credentials, d.signature, d.root);
        }
        require(total == msg.value, "batch value");
    }
}
