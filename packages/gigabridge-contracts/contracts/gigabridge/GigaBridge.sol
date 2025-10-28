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
    LazyIMTData tempSyncTree; // resets after each tx, will be moved into memory in future version once skinny-IMT is built
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
        gigaRoot = LazyImtPoseidon2.root(gigaTree);
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
        emit LeafRegistered(_owner, _updater, _index);

        // did we increase the depth of the tree? gigaDepth++ !
        uint256 _gigaRootDepth = gigaDepth;
        if (2 ** _gigaRootDepth <= _index) {
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
        // TODO add param names something like "_valueTimeStamp" and check that only the most recent index is added
        // but do store it in `leafHistory[_index][_value] = true;` for syncTree users
        // this is so you can ensure your leaf is always the most recent message, ex all adapters use it to pass the block number
        // TODO also emit that in the event
        // Maybe we can call "_valueTimeStamp" l2BlockNumber but that is technically incorrect since gigaBridge can be used with L2
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
        //TODO make skinnyIMT and let it run on memory. Then boom bam, merkle root for a fraction of the gas!!!!
        uint256 amountLeafs = _leafsIndexes[_leafsIndexes.length - 1] + 1; // because _leafsIndexes is sorted, the last index is also the largest index!
        LazyImtPoseidon2.init(tempSyncTree, uint8(_calculateDepth(amountLeafs)) + 1);

        uint256 _prevLeafIndex = 0;
        for (uint256 i = 0; i < _leafsValues.length; i++) {
            uint256 leafValue = _leafsValues[i];
            uint256 leafIndex = _leafsIndexes[i];

            // pendingLeaf.index bigger? that means there is a gap, fill it with zeros!!
            if(leafIndex > _prevLeafIndex + 1) { 
                uint256 zerosGap = leafIndex - _prevLeafIndex - 1;
                for (uint256 j = 0; j < zerosGap; j++) {
                    LazyImtPoseidon2.insert(tempSyncTree, 0);
                }
            }
            _prevLeafIndex = leafIndex;
            // finally we insert our pending leaf
            LazyImtPoseidon2.insert(tempSyncTree, leafValue);
        }

        uint256 _root = LazyImtPoseidon2.root(tempSyncTree);
        uint256 _depth = _calculateDepth(tempSyncTree.numberOfLeaves);
        addSyncRootToHistory(_root);
        emit NewRoot(_root,  _depth,  RootType.SYNC_ROOT); 
        emit NewSyncTree(_leafsValues, _leafsIndexes); 
        LazyImtPoseidon2.reset(tempSyncTree);
    }

    // @TODO _pendingLeafs should include indexes, since leaf values are not always unique, it means we cannot use _getIndexOfHistoricLeafValue to get the index!!
    function createPendingSyncTree(uint256 _syncTreeIndexSuggestion, uint256[] calldata _leafsValues, uint256[] calldata _leafsIndexes) public override returns(uint256 _syncTreeIndex) {
        _syncTreeIndex = _syncTreeIndexSuggestion;
        LazyIMTData storage syncTree = syncTrees[_syncTreeIndex];
        // just in case the index was already in use. We will try to find you another one!
        // TODO maybe we can de ae keccak hash of the leafsValues? and use that as an id?
        while(syncTree.numberOfLeaves != 0) {
            _syncTreeIndex++;
            syncTree = syncTrees[_syncTreeIndex];
        }
        SyncTreeData storage syncTreeData = syncTreesData[_syncTreeIndex];
        uint256 amountLeafs = _leafsIndexes[_leafsIndexes.length - 1] + 1; // because _leafsIndexes is sorted, the last index is also the largest index!
        LazyImtPoseidon2.init(syncTree, uint8(_calculateDepth(amountLeafs)) + 1); //TODO figure out why this needs +1? i guess it doesn't matter if this number is too large. But too small is bad! we can just hardcode 32 and not worry about it and just switch to leanIMT which is more based any way!! Yay!!!

        uint256 prevLeafIndex = 0;
        for (uint256 i = 0; i < _leafsValues.length; i++) {
            require(prevLeafIndex < _leafsIndexes[i] || i==0, "_leafsIndexes must be sorted in ascending order with no duplicates.");
            require(leafHistory[_leafsIndexes[i]][_leafsValues[i]] , "_leafsValues contains a leaf that has never existed.");
            syncTreesPendingLeafs[_syncTreeIndex][i] = PendingLeaf({
                value: _leafsValues[i],
                index: _leafsIndexes[i]
            });
            prevLeafIndex = _leafsIndexes[i];
        }
        syncTreeData.amountLeafs = _leafsValues.length;
        syncTreeData.creationBlock = block.number;
        syncTreeData.prevLeafIndex = _leafsIndexes[0];
        emit NewSyncTree(_leafsValues,  _leafsIndexes, _syncTreeIndex);

        return _syncTreeIndex;
    }
 
    function processSyncTree(uint256 _syncTreeIndex, uint256 _maxPendingLeafs) public override {
        // @TODO leanImt has bulk inserts! we should use them once we modify leanIMT to be-able to be reset and insert zeros in bulk
        SyncTreeData storage syncTreeData = syncTreesData[_syncTreeIndex];
        require(syncTreeData.amountLeafs != 0, "sync tree already done, nothing to process!");
        SyncTreeData memory _syncTreeData = syncTreeData;
        LazyIMTData storage syncTree = syncTrees[_syncTreeIndex];
        
        // calculate at what index to stop processing 
        uint256 _pendingLeafsLeft = _syncTreeData.amountLeafs - _syncTreeData.nextPendingLeafsIndex;
        bool _willComplete =  _maxPendingLeafs >= _pendingLeafsLeft;
        uint256 _lastPendingLeafIndex = _willComplete ? (_syncTreeData.amountLeafs - 1) : (_maxPendingLeafs + _syncTreeData.nextPendingLeafsIndex - 1); // @TODO save gas by removing -1 and doing < instead of <=

        // remember _pendingLeafIndex != _nextLeafIndex TODO naming
        uint256 _prevLeafIndex = _syncTreeData.prevLeafIndex;
        
        // loop over all pending leafs after .nextPendingLeafsIndex, and stop at 
        uint256 _pendingLeafIndex;
        for (_pendingLeafIndex = _syncTreeData.nextPendingLeafsIndex; _pendingLeafIndex <= _lastPendingLeafIndex; _pendingLeafIndex++) {
            PendingLeaf memory pendingLeaf = syncTreesPendingLeafs[_syncTreeIndex][_pendingLeafIndex];
            
            // pendingLeaf.index bigger? that means there is a gap, fill it with zeros!!
            if(pendingLeaf.index > _prevLeafIndex + 1) { 
                uint256 zerosGap = pendingLeaf.index - _prevLeafIndex - 1;
                for (uint i = 0; i < zerosGap; i++) {
                    LazyImtPoseidon2.insert(syncTree, 0);
                }
            }
            _prevLeafIndex = pendingLeaf.index;
            // finally we insert our pending leaf
            LazyImtPoseidon2.insert(syncTree, pendingLeaf.value);
        }

        if(_willComplete) {
            // now let's add the root
            uint256 _root = LazyImtPoseidon2.root(syncTree);
            uint256 _depth = _calculateDepth(syncTree.numberOfLeaves);
            // this to prevent a gigaRoot becoming a syncRoot
            addSyncRootToHistory(_root);
            emit NewRoot(_root, _depth, RootType.SYNC_ROOT, _syncTreeData.creationBlock);

            // we're done, let's cleanup the slots for reuse!
            // note we don't set  syncTreesPendingLeafs[_syncTreeIndex] to zeros since those will be overwritten by createNewSyncTree
            // TODO maybe we don't need all of them at zero, maybe we can just overwrite at next time createPendingSyncTree is called and only set amountLeafs to zero
            syncTreeData.prevLeafIndex = 0;
            syncTreeData.nextPendingLeafsIndex = 0;
            syncTreeData.amountLeafs = 0;
            LazyImtPoseidon2.reset(syncTree);
        } else {
            syncTreeData.prevLeafIndex = _prevLeafIndex;
            syncTreeData.nextPendingLeafsIndex = _pendingLeafIndex;
        }
    }

    function addSyncRootToHistory(uint256 _root)  internal {
        // this to prevent a gigaRoot becoming a syncRoot
        if (rootHistory[_root] == RootType.NOT_A_ROOT) {
            rootHistory[_root] = RootType.SYNC_ROOT;
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
        while(2**depth < _amountLeafs) {
            depth++;
        }
        return depth;
    }
}
