// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {InternalLazyIMT, LazyIMTData} from "zk-kit-lazy-imt-custom-hash/InternalLazyIMT.sol";
import {LazyImtPoseidon2} from "../imt-poseidon2/LazyImtPoseidon2.sol";

// TODO skinny-imt, lean-IMT but can run on memory as well (make version of LeanIMTData without mappings (and ditch leaves)), can reset and bulk insert zeros, doesn't care if an leafValue already exist, doesn't has `_has` and has no `leaves mapping`
// make PR on lean-imt, it uses _indexOf to get the index but you can also just provide it as function input, since it verifies the inclusion of the old leaf, which you cant do if the index is wrong
// TODO fat-imt, lean-IMT but can do updates without providing siblingNodes (who can get outdated), reset


enum RootType {
    NOT_A_ROOT, // mappings default to zero, this causes keys not set in rootHistory to default to NOT_A_ROOT
    GIGA_ROOT,
    SYNC_ROOT
}

struct PendingLeaf {
    uint256 value;
    uint256 index;
}

struct SyncTreeData {
    uint256 nextLeafIndex;
    uint256 nextPendingLeafsIndex;
    uint256 pendingLeafIndexLength;
    uint256 creationBlock;
}

event LeafUpdated(uint256 indexed index, uint256 indexed value);
event LeafRegistered(address indexed owner, address indexed updater, uint256 indexed index, uint256 value);
event NewSyncTree(uint256[] leafValues, uint256[] leafIndexes, uint256 indexed syncTreeIndex);
event NewSyncTree(uint256[] leafValues, uint256[] leafIndexes);
event NewRoot(uint256 indexed root, uint256 depth, RootType rootType);
event NewRoot(uint256 indexed root, uint256 depth, RootType rootType, uint256 syncTreeCreationBlock); // syncTreeCreationBlock is here so you can find out what leafs it was made with by finding NewPendingSyncTree. This narrow down the search to one block and in most cases 1 event!

contract GigaBridge {
    LazyIMTData gigaTree;
    uint256 nextIndex; // for lazyIMT you can also use gigaTree.numberOfLeaves, but we do this instead since we need to switch to a modified version of leanIMT anyway
    uint256 public gigaRoot;
    // no public syncTree root since syncTrees are user configurable and application specific, someone could make a syncTree full of zeros for example.
    uint256 public gigaDepth;
   

    mapping (uint256 => RootType) rootHistory;  // used to check if a sync/gigaRoot has existed in the past
    mapping (uint256 => mapping (uint256 => bool)) leafHistory;   // index => leafValue => bool

    mapping (uint256 => LazyIMTData) public syncTrees;
    mapping (uint256 => SyncTreeData) public syncTreesData;
    mapping (uint256 => mapping(uint256 => PendingLeaf)) syncTreesPendingLeafs; // syncTreeIndex => leafIndex => PendingLeaf

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
        leafHistory[_value][_index] = true;
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
        leafHistory[_value][_index] = true;
        emit LeafUpdated(_index, _value);

        // update root
        _root = LazyImtPoseidon2.root(gigaTree);
        gigaRoot = _root;
        rootHistory[_root] = RootType.GIGA_ROOT;
        emit NewRoot(_root, gigaDepth, RootType.GIGA_ROOT);
        return _root;
    }

    function createNewSyncTree(uint256[] calldata _leafsValues, uint256[] calldata _leafsIndexes) public {
        require(false, "sorry TODO!!!");
        //TODO make skinnyIMT and let it run on memory. Then boom bam, merkle root for a fraction of the gas!!!!
        uint256 _root = 69696969696969696996;
        uint256 _depth = 6969696969696969699;
        emit NewRoot(_root,  _depth,  RootType.SYNC_ROOT);
        emit NewSyncTree(_leafsValues, _leafsIndexes, block.number);
    }

    // @TODO _pendingLeafs should include indexes, since leaf values are not always unique, it means we cannot use _getIndexOfHistoricLeafValue to get the index!!
    function createPendingSyncTree(uint256 _syncTreeIndexSuggestion, uint256[] calldata _leafsValues, uint256[] calldata _leafsIndexes) public returns(uint256 _syncTreeIndex) {
        _syncTreeIndex = _syncTreeIndexSuggestion;
        LazyIMTData storage syncTree = syncTrees[_syncTreeIndex];
        // just in case the index was already in use. We will try to find you another one!
        while(syncTree.numberOfLeaves != 0) {
            _syncTreeIndex++;
            syncTree = syncTrees[_syncTreeIndex];
        }
        SyncTreeData storage syncTreeData = syncTreesData[_syncTreeIndex];
        for (uint i = 0; i < _leafsValues.length; i++) {
            syncTreesPendingLeafs[_syncTreeIndex][i] = PendingLeaf({
                value: _leafsValues[i],
                // _getIndexOfHistoricLeafValue also errors if its not a valid value
                index: _leafsIndexes[i]
            });
        }
        syncTreeData.pendingLeafIndexLength = _leafsValues.length;
        syncTreeData.creationBlock = block.number;
        emit NewSyncTree(_leafsValues,  _leafsIndexes, _syncTreeIndex);
        //TODO check this trustedRoot when processSyncTree completes. And void the thing if it doesn't match!!
        
        return _syncTreeIndex;
    }
 
    function processSyncTree(uint256 _syncTreeIndex, uint256 _maxPendingLeafs) public {
        // @TODO leanImt has bulk inserts! we should use them once we modify leanIMT to be-able to be reset and insert zeros in bulk
        SyncTreeData storage syncTreeData = syncTreesData[_syncTreeIndex];
        SyncTreeData memory _syncTreeData = syncTreeData;
        LazyIMTData storage syncTree = syncTrees[_syncTreeIndex];
        
        // calculate at what index to stop processing
        uint256 _pendingLeft = _syncTreeData.pendingLeafIndexLength - _syncTreeData.nextPendingLeafsIndex; // 9 pending, len = 9, 3 done=[0,1,2], next=3, max=6
        bool _willComplete =  _maxPendingLeafs >= _pendingLeft;
        uint256 _lastPendingLeafIndex = _willComplete ? (_syncTreeData.pendingLeafIndexLength - 1) : (_maxPendingLeafs + _syncTreeData.nextPendingLeafsIndex - 1); // @TODO save gas by removing -1 and doing < instead of <=

        // remember _pendingLeafIndex != _nextLeafIndex TODO naming
        uint256 _nextLeafIndex = _syncTreeData.nextLeafIndex;
        
        // loop over all pending leafs after .nextPendingLeafsIndex, and stop at 
        for (uint256 _pendingLeafIndex = _syncTreeData.nextPendingLeafsIndex; _pendingLeafIndex <= _lastPendingLeafIndex; _pendingLeafIndex++) {
            PendingLeaf memory pendingLeaf = syncTreesPendingLeafs[_syncTreeIndex][_pendingLeafIndex];
            
            // pendingLeaf.index bigger? that means there is a gap, fill it with zeros!!
            if(pendingLeaf.index > _nextLeafIndex) { 
                uint256 zerosGap = pendingLeaf.index - _nextLeafIndex;
                for (uint i = 0; i < zerosGap; i++) {
                    LazyImtPoseidon2.insert(syncTree, 0);
                }
                _nextLeafIndex += zerosGap + 1;
            } else {
                _nextLeafIndex++;
            }

            // finally we insert our pending leaf
            LazyImtPoseidon2.insert(syncTree, pendingLeaf.value);
        }

        if(_willComplete) {
            // we're done, let's cleanup the slots for reuse!
            // note we don't set  syncTreesPendingLeafs[_syncTreeIndex] to zeros since those will be overwritten by createNewSyncTree
            syncTreeData.nextLeafIndex = 0;
            syncTreeData.nextPendingLeafsIndex = 0;
            syncTreeData.pendingLeafIndexLength = 0;
            LazyImtPoseidon2.reset(syncTree);

            // now let's add the root
            uint256 _root = LazyImtPoseidon2.root(syncTree);
            uint256 _depth = _calculateDepth(_syncTreeData.pendingLeafIndexLength);
            rootHistory[_root] = RootType.SYNC_ROOT;
            emit NewRoot(_root, _depth, RootType.SYNC_ROOT, _syncTreeData.creationBlock);
        } else {
            syncTreeData.nextLeafIndex = _nextLeafIndex + 1;
            syncTreeData.nextPendingLeafsIndex = _nextLeafIndex + 1;
        }
    }

    function transferOwnerOfLeafIndex(uint256 _index, address _newOwner) public {
        require(indexPerOwner[_index] == msg.sender, "msg.sender is not the owner this _index");
        indexPerOwner[_index] = _newOwner;
    }

    function setUpdaterOfLeafIndex(uint256 _index, address _newUpdater) public {
        require(indexPerOwner[_index] == msg.sender, "msg.sender is not the owner this _index");
        indexPerUpdater[_index] = _newUpdater; 
    }

    function _calculateDepth(uint256 _amountLeafs) internal pure returns(uint256 depth) {
        depth = 0;
        while(2**depth < _amountLeafs) {
            depth++;
        }
        return depth;
    }
}
