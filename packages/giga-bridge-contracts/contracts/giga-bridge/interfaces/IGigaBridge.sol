// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IGigaBridge {

    struct PendingLeaf {
        uint256 value;
        uint256 index;
    }

    struct SyncTreeData {
        uint256 prevLeafIndex;
        uint256 nextPendingLeafsIndex;
        uint256 amountLeafs;
        uint256 creationBlock;
    }

    event LeafUpdated(uint256 indexed index, uint256 indexed value);
    event LeafRegistered(address indexed owner, address indexed updater, uint256 indexed index);
    event NewSyncTree(uint256[] leafValues, uint256[] leafIndexes, uint256 indexed syncTreeIndex);
    event NewSyncTree(uint256[] leafValues, uint256[] leafIndexes);
    event NewRoot(uint256 indexed root, uint256 depth, RootType rootType);
    event NewRoot(uint256 indexed root, uint256 depth, RootType rootType, uint256 syncTreeCreationBlock); // syncTreeCreationBlock is here so you can find out what leafs it was made with by finding NewPendingSyncTree. This narrow down the search to one block and in most cases 1 event!


    enum RootType {
        NOT_A_ROOT, // mappings default to zero, this causes keys not set in rootHistory to default to NOT_A_ROOT
        GIGA_ROOT,
        SYNC_ROOT
    }

    // functions
    function registerNewLeaf(address _owner, address _updater, uint256 _value) external returns (uint256 _root, uint256 _index);
    function updateLeaf(uint256 _value, uint256 _index) external returns (uint256 _root);
    function createPendingSyncTree(uint256 _syncTreeIndexSuggestion, uint256[] calldata _leafsValues, uint256[] calldata _leafsIndexes) external returns (uint256 _syncTreeIndex);
    function processSyncTree(uint256 _syncTreeIndex, uint256 _maxPendingLeafs) external;
    function transferOwnerOfLeafIndex(uint256 _index, address _newOwner) external;
    function setUpdaterOfLeafIndex(uint256 _index, address _newUpdater) external;

    // state
    function gigaRoot() external view returns (uint256);
    function nextGigaIndex() external view returns (uint256);
    function gigaDepth() external view returns (uint256);
    function syncTreesData(uint256 _syncTreeIndex) external view returns (uint256 nextLeafIndex, uint256 nextPendingLeafsIndex, uint256 pendingLeafIndexLength, uint256 creationBlock);
    function indexPerOwner(uint256 _index) external view returns (address);
    function indexPerUpdater(uint256 _index) external view returns (address);
    function rootHistory(uint256 _root) external view returns (RootType);
}