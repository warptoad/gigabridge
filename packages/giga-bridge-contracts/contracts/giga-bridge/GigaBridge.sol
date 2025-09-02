// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {InternalLazyIMT, LazyIMTData} from "zk-kit-lazy-imt-custom-hash/InternalLazyIMT.sol";
import {LazyImtPoseidon2} from "../imt-poseidon2/LazyImtPoseidon2.sol";
import {IGigaBridge} from "./interfaces/IGigaBridge.sol";

// TODO skinny-imt, lean-IMT but can run on memory as well (make version of LeanIMTData without mappings (and ditch leaves)), can reset and bulk insert zeros, doesn't care if an leafValue already exist, doesn't has `_has` and has no `leaves mapping`
// make PR on lean-imt, it uses _indexOf to get the index but you can also just provide it as function input, since it verifies the inclusion of the old leaf, which you cant do if the index is wrong
// TODO fat-imt, lean-IMT but can do updates without providing siblingNodes (who can get outdated), reset

contract GigaBridge is IGigaBridge {
    LazyIMTData gigaTree;
    uint256 public nextGigaIndex; // for lazyIMT you can also use gigaTree.numberOfLeaves, but we do this instead since we need to switch to a modified version of leanIMT anyway
    uint256 public gigaRoot;
    // no public syncTree root since syncTrees are user configurable and application specific, someone could make a syncTree full of zeros for example.
    uint256 public gigaDepth;

    mapping (uint256 => RootType) public rootHistory;  // used to check if a sync/gigaRoot has existed in the past
    mapping (uint256 => mapping (uint256 => bool)) leafHistory;   // index => leafValue => bool

    mapping (uint256 => LazyIMTData) syncTrees;
    mapping (uint256 => SyncTreeData) public syncTreesData;
    mapping (uint256 => mapping(uint256 => PendingLeaf)) syncTreesPendingLeafs; // syncTreeIndex => leafIndex => PendingLeaf

    mapping (uint256 => address) public indexPerOwner;
    mapping (uint256 => address) public indexPerUpdater;

    constructor(uint8 _maxDepth){
        LazyImtPoseidon2.init(gigaTree, _maxDepth);
    }

    function registerNewLeaf(address _owner, address _updater, uint256 _value) public override returns (uint256, uint256) {        
        // update nexIndex
        uint256 _index = nextGigaIndex;
        nextGigaIndex++;

        // track owner ship 
        indexPerOwner[_index] = _owner;
        indexPerUpdater[_index] = _updater;

        // insert leaf
        LazyImtPoseidon2.insert(gigaTree, _value);
        leafHistory[_index][_value] = true;
        emit LeafUpdated(_index, _value);
        emit LeafRegistered(_owner, _updater, _index, _value);

        // did we increase the depth of the tree? gigaDepth++ !
        uint256 _gigaRootDepth = gigaDepth;
        if (2 ** _gigaRootDepth <= _index+1) {
            _gigaRootDepth++;
            gigaDepth = _gigaRootDepth;
        }

        // update root
        uint256 _root = LazyImtPoseidon2.root(gigaTree);
        gigaRoot = _root;
        rootHistory[_root] = RootType.GIGA_ROOT;
        emit NewRoot(_root, _gigaRootDepth, RootType.GIGA_ROOT);
        return (_root, _index);
    }

    function updateLeaf(uint256 _value, uint256 _index) public override returns (uint256 _root) {
        require(indexPerUpdater[_index] == msg.sender, "msg.sender is not an authorized updater for this _index");
        
        // update leaf
        LazyImtPoseidon2.update(gigaTree, _value, uint40(_index));
        leafHistory[_index][_value] = true;
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
    function createPendingSyncTree(uint256 _syncTreeIndexSuggestion, uint256[] calldata _leafsValues, uint256[] calldata _leafsIndexes) public override returns(uint256 _syncTreeIndex) {
        _syncTreeIndex = _syncTreeIndexSuggestion;
        LazyIMTData storage syncTree = syncTrees[_syncTreeIndex];
        // just in case the index was already in use. We will try to find you another one!
        while(syncTree.numberOfLeaves != 0) {
            _syncTreeIndex++;
            syncTree = syncTrees[_syncTreeIndex];
        }
        SyncTreeData storage syncTreeData = syncTreesData[_syncTreeIndex];
        LazyImtPoseidon2.init(syncTree, uint8(_calculateDepth(_leafsValues.length)));

        uint256 prevLeafIndex = 0;
        for (uint256 i = 0; i < _leafsValues.length; i++) {
            if (i > 0 && _leafsIndexes[i] <= prevLeafIndex) {
                revert("_leafsIndexes must be sorted in ascending order");
            }
            require(leafHistory[_leafsIndexes[i]][_leafsValues[i]], "_leafsValues contains a leaf that has never existed at that index with no duplicates");
            syncTreesPendingLeafs[_syncTreeIndex][i] = PendingLeaf({
                value: _leafsValues[i],
                // _getIndexOfHistoricLeafValue also errors if its not a valid value
                index: _leafsIndexes[i]
            });
            prevLeafIndex = _leafsIndexes[i];
        }
        syncTreeData.pendingLeafIndexLength = _leafsValues.length;
        syncTreeData.creationBlock = block.number;
        emit NewSyncTree(_leafsValues,  _leafsIndexes, _syncTreeIndex);
        //TODO check this trustedRoot when processSyncTree completes. And void the thing if it doesn't match!!
        
        return _syncTreeIndex;
    }
 
    function processSyncTree(uint256 _syncTreeIndex, uint256 _maxPendingLeafs) public override {
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

    function transferOwnerOfLeafIndex(uint256 _index, address _newOwner) public override {
        require(indexPerOwner[_index] == msg.sender, "msg.sender is not the owner this _index");
        indexPerOwner[_index] = _newOwner;
    }

    function setUpdaterOfLeafIndex(uint256 _index, address _newUpdater) public override {
        require(indexPerOwner[_index] == msg.sender, "msg.sender is not the owner this _index");
        indexPerUpdater[_index] = _newUpdater; 
    }

    function _calculateDepth(uint256 _amountLeafs) internal pure returns(uint256 depth) {
        depth = 0;
        while(2**depth < _amountLeafs+1) {
            depth++;
        }
        return depth;
    }
}
