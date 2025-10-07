// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {AdapterCoreL1} from "../core/AdapterCoreL1.sol";
import {IAztecAdapterL1} from "./interfaces/IAztecAdapterL1.sol";


import {IRollup} from "@aztec/l1-contracts/src/core/interfaces/IRollup.sol";
import {IRegistry} from "@aztec/l1-contracts/src/governance/interfaces/IRegistry.sol";
import {IInbox} from "@aztec/l1-contracts/src/core/interfaces/messagebridge/IInbox.sol";
import {IOutbox} from "@aztec/l1-contracts/src/core/interfaces/messagebridge/IOutbox.sol";
import {DataStructures} from "@aztec/l1-contracts/src/core/libraries/DataStructures.sol";

struct L2ToL1MessageProof {
    uint256 witnessL2BlockNumber;
    uint256 leafIndex;
    bytes32[] path;
}

interface IPoseidon2 {
    function hash4(uint256[4] memory) external view returns (uint256);
}
contract AztecAdapterL1 is AdapterCoreL1, IAztecAdapterL1 {
    //TODO move to core
    address internal constant HASHER_ADDRESS = 0x5308AdF8a2B46dfe32a00503adD831174586FC16; 
    IPoseidon2 Poseidon2 = IPoseidon2(HASHER_ADDRESS);
    
    // cant be in core because ethAddress < aztecAddress or maybe make something generic?
    bytes32 l2AdapterAddress;

    // not core
    IInbox aztecInbox;
    IOutbox aztecOutbox;
    uint256 aztecRollupVersion;

    // note core?
    constructor(address _aztecRollupRegistry) {
        IRegistry aztecRegistry = IRegistry(_aztecRollupRegistry);
        // why does IRollup return iHasVersion?
        IRollup aztecRollup = IRollup(address(aztecRegistry.getCanonicalRollup()));
        aztecInbox = IInbox(aztecRollup.getInbox());
        aztecOutbox = IOutbox(aztecRollup.getOutbox());
        aztecRollupVersion = aztecRollup.getVersion();
    }

    // note core
    function updateFromL2(
        uint256 _leafIndex,
        uint256 _leafValue,
        uint256 _blockNumber,
        uint256 _registrant, // an aztec address

        L2ToL1MessageProof calldata _L2ToL1MessageProof
        ) public {
        uint256 _contentHash = Poseidon2.hash4([_leafIndex, _leafValue, _blockNumber, _registrant]);
        
        DataStructures.L2ToL1Msg memory _message = DataStructures.L2ToL1Msg({
            sender: DataStructures.L2Actor(l2AdapterAddress, aztecRollupVersion),
            recipient: DataStructures.L1Actor(address(this), block.chainid),
            content: bytes32(_contentHash)
        });
        aztecOutbox.consume(_message, _L2ToL1MessageProof.witnessL2BlockNumber, _L2ToL1MessageProof.leafIndex, _L2ToL1MessageProof.path);

        // pass message to _AInternalFunctionThatTracksOwnerShip(_leafIndex, _leafValue, _blockNumber, l2AdapterAddress, _registrant) <- core stuff
        // L1 adapter needs to track ownerShip because if you do it on L2 registering will take very long on optimism for example
    }
}