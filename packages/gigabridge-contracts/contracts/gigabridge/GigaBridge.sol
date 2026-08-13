// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FatIMTPoseidon2WriteStorage, FatIMTDataStorage} from "@warptoad/fat-imt.sol/poseidon2/FatIMTPoseidon2WriteStorage.sol";
import {SkinnyIMTPoseidon2WriteStorage, SkinnyIMTDataStorage} from "@warptoad/skinny-imt.sol/poseidon2/SkinnyIMTPoseidon2WriteStorage.sol";
import {FatIMTPoseidon2Read} from "@warptoad/fat-imt.sol/poseidon2/FatIMTPoseidon2Read.sol";
import {SkinnyIMTPoseidon2Read} from "@warptoad/skinny-imt.sol/poseidon2/SkinnyIMTPoseidon2Read.sol";
import {IGigaBridge} from "./interfaces/IGigaBridge.sol";

import {SkinnyIMTReadableStorage} from "@warptoad/skinny-imt.sol/SkinnyIMTReadableStorage.sol";
import {FatIMTReadableStorage} from "@warptoad/fat-imt.sol/FatIMTReadableStorage.sol";
import {IIMTEvents} from "@warptoad/fat-imt.sol/interfaces/IIMTEvents.sol";

// NOTE: fat-imt/skinny-imt emit their own NewLeaf/RepeatedLeafs/UpdatedLeaf events on top of the ones
// emitted here. That is double emitting, it will be cleaned up once the js syncing logic moves over to the lib events.
// TODO skinny-imt can run in memory, so tempSyncTree/syncTrees don't need to touch storage at all.

contract GigaBridge is
    IGigaBridge,
    SkinnyIMTReadableStorage,
    FatIMTReadableStorage,
    IIMTEvents
{
    FatIMTDataStorage gigaTree;
    SkinnyIMTDataStorage syncTree; // resets after each tx, will be moved into memory in future version

    uint256 public gigaTreeId;
    uint256 public syncTreeId;

    mapping(uint256 => RootType) public rootHistory; // used to check if a sync/gigaRoot has existed in the past
    mapping(uint256 => mapping(uint256 => bool)) leafHistory; // index => leafValue => bool

    mapping(uint256 => address) public indexPerOwner;
    mapping(uint256 => address) public indexPerUpdater;

    constructor() {
        gigaTreeId = FatIMTPoseidon2WriteStorage.init(gigaTree);
        syncTreeId = SkinnyIMTPoseidon2WriteStorage.init(syncTree);
    }

    function supportsInterface(
        bytes4 interfaceId
    )
        public
        view
        override(FatIMTReadableStorage, SkinnyIMTReadableStorage)
        returns (bool)
    {
        // this calls FatIMTReadableStorage.supportsInterface(), which contains a super in it as well which then will
        // call the skinny variant since it is also inherited
        return super.supportsInterface(interfaceId);
    }

    function _getFatStorageTree(uint256) internal view override returns (FatIMTDataStorage storage) {
        return gigaTree;
    }

    function _getSkinnyStorageTree(uint256) internal view override returns (SkinnyIMTDataStorage storage) {
        return syncTree;
    }

    function gigaRoot() public view returns (uint256) {
        return FatIMTPoseidon2Read.root(gigaTree.treeData);
    }

    function nextGigaIndex() public view returns (uint256) {
        // TODO this guy is obv not skinny, maybe rename that to treeData?
        return gigaTree.treeData.size;
    }

    function gigaDepth() public view returns (uint256) {
        return gigaTree.treeData.depth;
    }

    /// @dev skinny/fat-imt have no reset(), but zeroing size+depth is enough: every `sideNodes` slot a
    /// later insert reads is written by an earlier insert of that same run. treeId is kept so the tree stays initialized.
    // TODO is this safe? Should we add this to skinny fat?
    function _resetSyncTree(SkinnyIMTDataStorage storage _syncTree) internal {
        _syncTree.treeData.size = 0;
        _syncTree.treeData.depth = 0;
    }

    /// @dev trees are lazily initialized, syncTrees live in a mapping so they can't be initialized in the constructor.
    // TODO this can be nicer?
    function _initSyncTreeIfNeeded(
        SkinnyIMTDataStorage storage _syncTree
    ) internal {
        if (_syncTree.treeData.treeId == 0) {
            SkinnyIMTPoseidon2WriteStorage.init(_syncTree);
        }
    }

    function registerNewLeaf(
        address _owner,
        address _updater,
        uint256 _value
    ) public override returns (uint256, uint256) {
        // insert leaf
        (uint256 _root, uint256 _index) = FatIMTPoseidon2WriteStorage.insert(
            gigaTree,
            _value
        );
        leafHistory[_index][_value] = true;
        // TODO remove
        emit LeafRegistered(_owner, _updater, _index);

        // track owner ship
        indexPerOwner[_index] = _owner;
        indexPerUpdater[_index] = _updater;

        // fat-imt grows its depth on insert, just mirror it
        // uint256 _gigaRootDepth = gigaTree.treeData.depth;

        // update root
        rootHistory[_root] = RootType.GIGA_ROOT;
        // why depth in the event???
        return (_root, _index);
    }

    function updateLeaf(
        uint256 _value,
        uint256 _index
    ) public override returns (uint256 _root) {
        // TODO add param names something like "_valueTimeStamp" and check that only the most recent index is added
        // but do store it in `leafHistory[_index][_value] = true;` for syncTree users
        // this is so you can ensure your leaf is always the most recent message, ex all adapters use it to pass the block number
        // TODO also emit that in the event
        // Maybe we can call "_valueTimeStamp" l2BlockNumber but that is technically incorrect since gigaBridge can be used with L2
        require(
            indexPerUpdater[_index] == msg.sender,
            "msg.sender is not an authorized updater for this _index"
        );

        // update leaf
        (_root, ) = FatIMTPoseidon2WriteStorage.update(
            gigaTree,
            _value,
            _index
        );
        leafHistory[_index][_value] = true;
        // TODO remove

        // update root
        rootHistory[_root] = RootType.GIGA_ROOT;
        // TODO add NewRoot to skinny and fat?
        return _root;
    }

    function createNewSyncTree(
        uint256[] calldata _leafsValues,
        uint256[] calldata _leafsIndexes
    ) public {
        //TODO let skinnyIMT run on memory. Then boom bam, merkle root for a fraction of the gas!!!!
        _initSyncTreeIfNeeded(syncTree);

        uint256 _prevLeafIndex = 0;
        for (uint256 i = 0; i < _leafsValues.length; i++) {
            uint256 leafValue = _leafsValues[i];
            uint256 leafIndex = _leafsIndexes[i];

            // pendingLeaf.index bigger? that means there is a gap, fill it with zeros!!
            if (leafIndex > _prevLeafIndex + 1) {
                SkinnyIMTPoseidon2WriteStorage.insertManyRepeated(
                    syncTree,
                    0,
                    leafIndex - _prevLeafIndex - 1
                );
            }
            _prevLeafIndex = leafIndex;
            // finally we insert our pending leaf
            SkinnyIMTPoseidon2WriteStorage.insert(syncTree, leafValue);
        }

        uint256 _root = SkinnyIMTPoseidon2Read.root(syncTree.treeData);
        addSyncRootToHistory(_root);
        _resetSyncTree(syncTree);
    }

    function addSyncRootToHistory(uint256 _root) internal {
        // this to prevent a gigaRoot becoming a syncRoot
        if (rootHistory[_root] == RootType.NOT_A_ROOT) {
            rootHistory[_root] = RootType.SYNC_ROOT;
        }
    }

    function transferOwnerOfLeafIndex(
        uint256 _index,
        address _newOwner
    ) public override {
        require(
            indexPerOwner[_index] == msg.sender,
            "msg.sender is not the owner this _index"
        );
        indexPerOwner[_index] = _newOwner;
    }

    function setUpdaterOfLeafIndex(
        uint256 _index,
        address _newUpdater
    ) public override {
        require(
            indexPerOwner[_index] == msg.sender,
            "msg.sender is not the owner this _index"
        );
        indexPerUpdater[_index] = _newUpdater;
    }
}
