// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

contract testPoseidon {
    address internal constant POSEIDON2_ADDRESS = 0x382ABeF9789C1B5FeE54C72Bd9aaf7983726841C; // yul-recompile-200: 0xb41072641808e6186eF5246fE1990e46EB45B65A gas: 62572, huff: 0x382ABeF9789C1B5FeE54C72Bd9aaf7983726841C gas:39 627, yul-lib: 0x925e05cfb89f619BE3187Bf13D355A6D1864D24D, 

    // for gas testing
    function hashPayable(uint256[2] calldata inputs) public payable returns (uint256) {
        (, bytes memory result) = POSEIDON2_ADDRESS.staticcall(abi.encode(inputs[0],inputs[1]));
        return uint256(bytes32(result));
    }
    function hash(uint256[2] calldata inputs) public view returns (uint256) {
        (, bytes memory result) = POSEIDON2_ADDRESS.staticcall(abi.encode(inputs[0],inputs[1]));
        return uint256(bytes32(result));
    }
}
