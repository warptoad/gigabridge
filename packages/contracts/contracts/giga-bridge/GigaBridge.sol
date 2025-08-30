// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {InternalLazyIMT, LazyIMTData} from "zk-kit-lazy-imt-custom-hash/InternalLazyIMT.sol";
import {LazyImtPoseidon2} from "../imt-poseidon2/LazyImtPoseidon2.sol";


enum RootType {
    NOT_A_ROOT, // mappings default to zero, this causes keys not set in rootHistory to default to NOT_A_ROOT
    GIGA_ROOT,
    SYNC_ROOT
}

event LeafUpdated(uint256 indexed index, uint256 indexed value);
event LeafRegistered(address indexed owner, address indexed updater, uint256 indexed index, uint256 value);
event NewRoot(uint256 indexed root, uint256 depth, RootType rootType);

contract GigaBridge {
    LazyIMTData gigaTree;
    uint256 nextIndex; // for lazyIMT you can also use gigaTree.numberOfLeaves, but we do this instead since we need to switch to a modified version of leanIMT anyway
    uint256 gigaRoot;
    uint256 gigaDepth=0;
    // no sync tree root since syncTrees are user configurable and application specific, someone could make a syncTree full of zeros for example.

    mapping (uint256 => RootType) rootHistory;  // used to check if a sync/gigaRoot has existed in the past
    mapping (uint256 => uint256) leafHistory;   // leafValue => index+1

    mapping (uint256 => LazyIMTData) syncTrees;

    mapping (uint256 => address) indexPerOwner;
    mapping (uint256 => address) indexPerUpdater;

    constructor(uint8 _maxDepth){
        LazyImtPoseidon2.init(gigaTree, _maxDepth);
    }

    function registerNewLeaf(address _owner, address _updater, uint256 _value) public returns (uint256 _root, uint256 _index) {
        // track owner ship 
        indexPerOwner[_index] = _owner;
        indexPerUpdater[_index] = _updater;
        
        // update nexIndex
        _index = nextIndex;
        nextIndex++;

        // insert leaf
        LazyImtPoseidon2.insert(gigaTree, _value);
        _addLeafValueToHistory(_value, _index);
        emit LeafUpdated(_index, _value);
        emit LeafRegistered(_owner, _updater, _index, _value);

        // did we increase the depth of the tree? gigaDepth++ !
        uint256 _gigaRootDepth = gigaDepth;
        if (2 ** _gigaRootDepth <= _index+1) {
            _gigaRootDepth++;
            gigaDepth = _gigaRootDepth;
        }

        // update root
        _root = LazyImtPoseidon2.root(gigaTree);
        gigaRoot = _root;
        rootHistory[_root] = RootType.GIGA_ROOT;
        emit NewRoot(_root, _gigaRootDepth, RootType.GIGA_ROOT);
        return (_root, _index);
    }

    function updateLeaf(uint256 _value, uint256 _index) public returns (uint256 _root) {
        require(indexPerUpdater[_index] == msg.sender, "msg.sender is not an authorized updater for this _index");
        
        // update leaf
        LazyImtPoseidon2.update(gigaTree, _value, uint40(_index));
        _addLeafValueToHistory(_value, _index);
        emit LeafUpdated(_index, _value);

        // update root
        _root = LazyImtPoseidon2.root(gigaTree);
        gigaRoot = _root;
        rootHistory[_root] = RootType.GIGA_ROOT;
        emit NewRoot(_root, gigaDepth, RootType.GIGA_ROOT);
        return _root;
    }

    function transferOwnerOfLeafIndex(uint256 _index, address _newOwner) public {
        require(indexPerOwner[_index] == msg.sender, "msg.sender is not the owner this _index");
        indexPerOwner[_index] = _newOwner;
    }

    function setUpdaterOfLeafIndex(uint256 _index, address _newUpdater) public {
        require(indexPerOwner[_index] == msg.sender, "msg.sender is not the owner this _index");
        indexPerUpdater[_index] = _newUpdater; 
    }

    function _addLeafValueToHistory(uint256 _value, uint256 _index) internal {
        leafHistory[_value] = _index + 1;
    }

    function _getIndexOfHistoricLeafValue(uint256 _value) public view returns(uint256 _index) {
        _index = leafHistory[_value];
        require(_index != 0, "leafValue never existed");
        return _index - 1;
    }
}
