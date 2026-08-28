// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {
    FatIMTPoseidon2WriteStorage,
    FatIMTDataStorage
} from "@warptoad/fat-imt.sol/poseidon2/FatIMTPoseidon2WriteStorage.sol";
import {
    SkinnyIMTPoseidon2WriteEvent,
    SkinnyIMTDataEvent
} from "@warptoad/skinny-imt.sol/poseidon2/SkinnyIMTPoseidon2WriteEvent.sol";
import {FatIMTPoseidon2Read} from "@warptoad/fat-imt.sol/poseidon2/FatIMTPoseidon2Read.sol";
import {SkinnyIMTPoseidon2Read} from "@warptoad/skinny-imt.sol/poseidon2/SkinnyIMTPoseidon2Read.sol";
import {IGigaBridge} from "./interfaces/IGigaBridge.sol";

import {SkinnyIMTReadableEvent} from "@warptoad/skinny-imt.sol/SkinnyIMTReadableEvent.sol";
import {FatIMTReadableStorage} from "@warptoad/fat-imt.sol/FatIMTReadableStorage.sol";
import {IIMTEvents} from "@warptoad/fat-imt.sol/interfaces/IIMTEvents.sol";

// NOTE: fat-imt/skinny-imt emit their own NewLeaf/RepeatedLeafs/UpdatedLeaf events on top of the ones
// emitted here. That is double emitting, it will be cleaned up once the js syncing logic moves over to the lib events.
// TODO skinny-imt can run in memory, so tempSyncTree/syncTrees don't need to touch storage at all.

contract GigaBridge is IGigaBridge, SkinnyIMTReadableEvent, FatIMTReadableStorage, IIMTEvents {
    FatIMTDataStorage gigaTree;
    SkinnyIMTDataEvent syncTree; // resets after each tx, will be moved into memory in future version

    uint256 public gigaTreeId;
    uint256 public syncTreeId;

    // @TODO also store blockNumber in here not just type
    // with syncTree store oldest blocknumber of all leafs, so others can consider values expired

    // root type is stored here for consuming contract to distinguish between a syncRoot and a gigaRoot
    // size is here so merkle proofs can also be verified of which index they belong, 
    // this is because the leanIMT structure of the tree causes nodes to be hoisted up, 
    // causing leaves to exist on a higher level then their index suggest. Knowing the size you can calculate when this hoisting happens so you can deal with this and maintain correctness of that leaf index
    mapping(uint256 => RootData) public rootHistory; // used to check if a sync/gigaRoot has existed in the past
    
    // @TODO store blocknumber here instead of bool
    mapping(uint256 => mapping(uint256 => bool)) public leafHistory; // index => leafValue => bool

    mapping(uint256 => address) public indexPerOwner;
    mapping(uint256 => address) public indexPerUpdater;

    constructor() {
        gigaTreeId = FatIMTPoseidon2WriteStorage.init(gigaTree);
        syncTreeId = SkinnyIMTPoseidon2WriteEvent.init(syncTree);
    }

    function supportsInterface(bytes4 interfaceId)
        public
        view
        override(FatIMTReadableStorage, SkinnyIMTReadableEvent)
        returns (bool)
    {
        // this calls FatIMTReadableStorage.supportsInterface(), which contains a super in it as well which then will
        // call the skinny variant since it is also inherited
        return super.supportsInterface(interfaceId);
    }

    function _getFatStorageTree(uint256 _treeId) internal view override returns (FatIMTDataStorage storage) {
        if (_treeId != gigaTreeId) revert UnknownTreeId(_treeId);
        return gigaTree;
    }

    function _getSkinnyEventTree(uint256 _treeId) internal view override returns (SkinnyIMTDataEvent storage) {
        if (_treeId != syncTreeId) revert UnknownTreeId(_treeId);
        return syncTree;
    }

    function gigaRoot() public view returns (uint256) {
        return FatIMTPoseidon2Read.root(gigaTree.treeData);
    }

    function registerNewLeaf(uint256 _value, address _owner, address _updater)
        public
        override
        returns (uint256, uint256)
    {
        // insert leaf
        (uint256 _root, uint256 _index) = FatIMTPoseidon2WriteStorage.insert(gigaTree, _value);
        leafHistory[_index][_value] = true;
        // TODO remove
        emit LeafRegistered(_owner, _updater, _index);

        // track owner ship
        indexPerOwner[_index] = _owner;
        indexPerUpdater[_index] = _updater;

        // fat-imt grows its depth on insert, just mirror it
        // uint256 _gigaRootDepth = gigaTree.treeData.depth;

        // update root
        rootHistory[_root] = RootData({
            rootType: RootType.GIGA_ROOT,
            treeSize: gigaTree.treeData.size,
            treeDepth: gigaTree.treeData.depth
        });
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
        (_root,) = FatIMTPoseidon2WriteStorage.update(gigaTree, _value, _index);
        leafHistory[_index][_value] = true;
        // TODO remove

        // update root
        rootHistory[_root] = RootData({
            rootType: RootType.GIGA_ROOT,
            treeSize: gigaTree.treeData.size,
            treeDepth: gigaTree.treeData.depth
        });
        // TODO add NewRoot to skinny and fat?
        return _root;
    }

    function createNewSyncTree(uint256[] calldata _leafsValues, uint256[] calldata _leafsIndexes) public {
        uint256 _prevLeafIndex = 0;
        uint256 _runStart = 0; // where the run of consecutive leafs we are gathering starts in _leafsValues
        for (uint256 i = 0; i < _leafsValues.length; i++) {
            uint256 leafIndex = _leafsIndexes[i];
            uint256 leafValue = _leafsValues[i];
            // you cant just make something up
            require(leafHistory[leafIndex][leafValue], "one or more leaf values never existed at provided index.");
            // detect if there is a gap, insert all leaves before the gap, then fill the gap with zeros with insertManyRepeated
            if (leafIndex > _prevLeafIndex + 1) {
                // check if there are consecutive leaves to insert before we fill the gap
                if (i - _runStart > 1) {
                    SkinnyIMTPoseidon2WriteEvent.insertMany(syncTree, _leafsValues[_runStart:i]);
                    // if it is only one leaf before the gap, do only insert to save gas
                } else if (i - _runStart == 1) {
                    SkinnyIMTPoseidon2WriteEvent.insert(syncTree, _leafsValues[_runStart]);
                }
                _runStart = i;

                // fill our gap
                SkinnyIMTPoseidon2WriteEvent.insertManyRepeated(syncTree, 0, leafIndex - _prevLeafIndex - 1);
            }
            _prevLeafIndex = leafIndex;
        }

        // insert last batch of leaves
        if (_leafsValues.length - _runStart > 1) {
            SkinnyIMTPoseidon2WriteEvent.insertMany(syncTree, _leafsValues[_runStart:]);
        } else if (_leafsValues.length - _runStart == 1) {
            SkinnyIMTPoseidon2WriteEvent.insert(syncTree, _leafsValues[_runStart]);
        }

        uint256 _root = SkinnyIMTPoseidon2Read.root(syncTree);
        addSyncRootToHistory(_root);
        SkinnyIMTPoseidon2WriteEvent.reset(syncTree);
    }

    function addSyncRootToHistory(uint256 _root) internal {
        // this to prevent a syncRoot becoming a gigaRoot
        if (rootHistory[_root].rootType == RootType.NOT_A_ROOT) {
            rootHistory[_root] = RootData({
                rootType: RootType.SYNC_ROOT,
                treeSize: syncTree.size,
                treeDepth: syncTree.depth
            });
        } 
        // else { it's already in there, same root same depth and size, just a GIGA_ROOT instead }
    }

    function transferOwnerOfLeafIndex(uint256 _index, address _newOwner) public override {
        require(indexPerOwner[_index] == msg.sender, "msg.sender is not the owner this _index");
        indexPerOwner[_index] = _newOwner;
    }

    function setUpdaterOfLeafIndex(uint256 _index, address _newUpdater) public override {
        require(indexPerOwner[_index] == msg.sender, "msg.sender is not the owner this _index");
        indexPerUpdater[_index] = _newUpdater;
    }
}
