// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {FatIMTPoseidon2FullNode} from "@warptoad/fat-imt.sol/poseidon2/FatIMTPoseidon2FullNode.sol";
import {FatIMTDataFullNode} from "@warptoad/fat-imt.sol/InternalFatIMTStorage.sol";
import {SkinnyIMTPoseidon2} from "@warptoad/skinny-imt.sol/poseidon2/SkinnyIMTPoseidon2.sol";
import {SkinnyIMTData} from "@warptoad/skinny-imt.sol/InternalSkinnyIMTCore.sol";
import {IGigaBridge} from "./interfaces/IGigaBridge.sol";

// NOTE: fat-imt/skinny-imt emit their own NewLeaf/RepeatedLeafs/UpdatedLeaf events on top of the ones
// emitted here. That is double emitting, it will be cleaned up once the js syncing logic moves over to the lib events.
// TODO skinny-imt can run in memory, so tempSyncTree/syncTrees don't need to touch storage at all.

contract GigaBridge is IGigaBridge {
    FatIMTDataFullNode gigaTree;
    SkinnyIMTData tempSyncTree; // resets after each tx, will be moved into memory in future version

    mapping(uint256 => RootType) public rootHistory; // used to check if a sync/gigaRoot has existed in the past
    mapping(uint256 => mapping(uint256 => bool)) leafHistory; // index => leafValue => bool

    mapping(uint256 => address) public indexPerOwner;
    mapping(uint256 => address) public indexPerUpdater;

    constructor() {
        FatIMTPoseidon2FullNode.init(gigaTree);
    }

    function gigaRoot() public view returns (uint256) {
        return FatIMTPoseidon2FullNode.root(gigaTree);
    }

    function nextGigaIndex() public view returns (uint256) {
        // TODO this guy is obv not skinny, maybe rename that to treeData?
        return gigaTree.skinnyData.size;
    }

    function gigaDepth() public view returns (uint256) {
        return gigaTree.skinnyData.depth;
    }

    /// @dev skinny/fat-imt have no reset(), but zeroing size+depth is enough: every `sideNodes` slot a
    /// later insert reads is written by an earlier insert of that same run. treeId is kept so the tree stays initialized.
    // TODO is this safe? Should we add this to skinny fat?
    function _resetSyncTree(SkinnyIMTData storage _syncTree) internal {
        _syncTree.size = 0;
        _syncTree.depth = 0;
    }

    /// @dev trees are lazily initialized, syncTrees live in a mapping so they can't be initialized in the constructor.
    // TODO this can be nicer?
    function _initSyncTreeIfNeeded(SkinnyIMTData storage _syncTree) internal {
        if (_syncTree.treeId == 0) {
            SkinnyIMTPoseidon2.init(_syncTree);
        }
    }

    function registerNewLeaf(
        address _owner,
        address _updater,
        uint256 _value
    ) public override returns (uint256, uint256) {
        // insert leaf
        (uint256 _root, uint256 _index) = FatIMTPoseidon2FullNode.insert(
            gigaTree,
            _value
        );
        leafHistory[_index][_value] = true;
        // TODO remove
        emit LeafUpdated(_index, _value);
        emit LeafRegistered(_owner, _updater, _index);

        // track owner ship
        indexPerOwner[_index] = _owner;
        indexPerUpdater[_index] = _updater;

        // fat-imt grows its depth on insert, just mirror it
        uint256 _gigaRootDepth = gigaTree.skinnyData.depth;

        // update root
        rootHistory[_root] = RootType.GIGA_ROOT;
        // why depth in the event???
        emit NewRoot(_root, _gigaRootDepth, RootType.GIGA_ROOT);
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
        (_root, ) = FatIMTPoseidon2FullNode.update(gigaTree, _value, _index);
        leafHistory[_index][_value] = true;
        // TODO remove
        emit LeafUpdated(_index, _value);

        // update root
        rootHistory[_root] = RootType.GIGA_ROOT;
        // TODO add NewRoot to skinny and fat?
        emit NewRoot(_root, gigaDepth(), RootType.GIGA_ROOT);
        return _root;
    }

    function createNewSyncTree(
        uint256[] calldata _leafsValues,
        uint256[] calldata _leafsIndexes
    ) public {
        //TODO let skinnyIMT run on memory. Then boom bam, merkle root for a fraction of the gas!!!!
        _initSyncTreeIfNeeded(tempSyncTree);

        uint256 _prevLeafIndex = 0;
        for (uint256 i = 0; i < _leafsValues.length; i++) {
            uint256 leafValue = _leafsValues[i];
            uint256 leafIndex = _leafsIndexes[i];

            // pendingLeaf.index bigger? that means there is a gap, fill it with zeros!!
            if (leafIndex > _prevLeafIndex + 1) {
                SkinnyIMTPoseidon2.insertManyRepeated(
                    tempSyncTree,
                    0,
                    leafIndex - _prevLeafIndex - 1
                );
            }
            _prevLeafIndex = leafIndex;
            // finally we insert our pending leaf
            SkinnyIMTPoseidon2.insert(tempSyncTree, leafValue);
        }

        uint256 _root = SkinnyIMTPoseidon2.root(tempSyncTree);
        uint256 _depth = tempSyncTree.depth;
        addSyncRootToHistory(_root);
        emit NewRoot(_root, _depth, RootType.SYNC_ROOT);
        emit NewSyncTree(_leafsValues, _leafsIndexes);
        _resetSyncTree(tempSyncTree);
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
