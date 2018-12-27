pragma solidity ^0.5.0;
pragma experimental ABIEncoderV2;

contract ValidatorRegistration {

    event Eth1Deposit(
        bytes32 previousReceiptRoot,
        bytes data,
        uint depositCount
    );

    event ChainStart(
        bytes32 receiptRoot,
        bytes time
    );

    uint public constant DEPOSIT_SIZE = 32 ether;
    uint public constant DEPOSITS_FOR_CHAIN_START = 8;
    uint public constant MIN_TOPUP_SIZE = 1 ether;
    uint public constant GWEI_PER_ETH = 10 ** 9;
    uint public constant DEPOSIT_CONTRACT_TREE_DEPTH = 32;
    uint public constant SECONDS_PER_DAY = 86400;

    mapping (uint => bytes32) public receiptTree;
    uint public depositCount;
    uint public totalDepositCount;

    // When users wish to become a validator by moving ETH from
    // 1.0 chain to the 2.0 chain, they should call this function
    // sending along DEPOSIT_SIZE ETH and providing depositParams
    // as a simple serialize'd DepositParams object of the following
    // form: 
    // {
    //    'pubkey': 'int256',
    //    'proof_of_possession': ['int256'],
    //    'withdrawal_credentials`: 'hash32',
    //    'randao_commitment`: 'hash32'
    // }
    function deposit(
        bytes memory depositParams
    )
        public
        payable
    {
        require(
            depositParams.length == 2048,
            "Deposit parameters must be 2048 bytes in length"
        );
        require(
            msg.value <= DEPOSIT_SIZE,
            "Deposit can't be greater than DEPOSIT_SIZE."
        );
        require(
            msg.value >= MIN_TOPUP_SIZE,
            "Deposit can't be lesser than MIN_TOPUP_SIZE."
        );

        uint index = depositCount + 2 ** DEPOSIT_CONTRACT_TREE_DEPTH;
        bytes memory msgGweiInBytes = toBytes(msg.value / GWEI_PER_ETH);
        bytes memory timeStampInBytes = toBytes(block.timestamp);
        bytes memory depositData = abi.encodePacked(msgGweiInBytes, timeStampInBytes, depositParams);

        emit Eth1Deposit(receiptTree[1], depositData, depositCount);

        receiptTree[index] = keccak256(depositData);
        for (uint i = 0; i < DEPOSIT_CONTRACT_TREE_DEPTH; i++) {
            index = index / 2;
            receiptTree[index] = keccak256(abi.encodePacked(receiptTree[index * 2], receiptTree[index * 2 + 1]));
        }

        depositCount++;
        if (msg.value == DEPOSIT_SIZE) {
            totalDepositCount++;
            if (totalDepositCount == DEPOSITS_FOR_CHAIN_START) {
                uint timestampDayBoundary = block.timestamp - block.timestamp % SECONDS_PER_DAY + SECONDS_PER_DAY;
                bytes memory timestampDayBoundaryBytes = toBytes(timestampDayBoundary);
                emit ChainStart(receiptTree[1], timestampDayBoundaryBytes);
            }
        }
    }

    function getReceiptRoot() public view returns (bytes32) {
        return receiptTree[1];
    }

    // Gets last 8 bytes of uint256
    function toBytes(uint x) private pure returns (bytes memory) {
        bytes memory b = new bytes(32);
        assembly {
          mstore(add(b, 32), x)
        }
        return b;
    }
}
