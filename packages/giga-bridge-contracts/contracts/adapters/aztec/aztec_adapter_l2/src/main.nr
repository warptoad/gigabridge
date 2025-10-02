use dep::aztec::macros::aztec;

contract Main {
    use aztec::{
        context,
        event::event_interface::{emit_event_in_private, MessageDelivery},
        oracle::random::random,
        event::event_interface::{emit_event_in_public},
        macros::{events::event, functions::{internal, private, public, utility}, storage::storage},
        note::{note_getter::get_note},
        state_vars::{PublicImmutable, Map, PublicMutable, storage::HasStorageSlot, private_mutable::PrivateMutable},
        protocol_types::{
            hash::poseidon2_hash, abis::block_header::BlockHeader,
            address::{AztecAddress, EthAddress},
            storage::map::derive_storage_slot_in_map,
            traits::Serialize,
        },
        utils::{
            with_hash::WithHash::{self},
        },
    };

    //TODO use enums once available
    global NOT_A_ROOT: u8 = 0; // mappings default to zero, this causes keys not set in rootHistory to default to NOT_A_ROOT
    global GIGA_ROOT: u8 = 1;
    global SYNC_ROOT: u8 = 2;

    #[storage]
    struct Storage<Context> {
        aztec_l1_adapter: PublicImmutable<EthAddress, Context>,
        owner_of_leaf_index: Map<AztecAddress, PublicMutable<u128, Context>, Context>,
        // TODO use enums once available
        root_history: Map<Field, PublicImmutable<u8, Context>, Context>,
        giga_root: PublicMutable<Field, Context>
    }

    #[public]
    fn initialize(aztec_l1_adapter: EthAddress) {
        storage.aztec_l1_adapter.initialize(aztec_l1_adapter); 
    }

    #[public]
    fn update_leaf(leaf_index: u128, leaf_value: Field) {
        // make sure msg.sender is the contract that is registered on L1
        // message l1 adapter updateFromL2(leaf_index, leaf_value, msg.sender)
        let block_number: u32 = context.block_number();
        let registrant: AztecAddress = context.msg_sender();
        let content_hash: Field = poseidon2_hash([leaf_index as Field, leaf_value as Field, block_number as Field, registrant.inner]);
        let aztec_l1_adapter: EthAddress = storage.aztec_l1_adapter.read();
        context.message_portal(aztec_l1_adapter, content_hash);
    }

    #[public]
    fn receive_root(root: Field, root_type: u8, bridge_message_leaf_index: Field) {
        assert((root_type == GIGA_ROOT) | (root_type == SYNC_ROOT) , "invalid root type");

        // no secrets here!
        let secret: Field = 0;
        let content_hash: Field = poseidon2_hash([root, root_type as Field]);
        let aztec_l1_adapter: EthAddress = storage.aztec_l1_adapter.read();
        context.consume_l1_to_l2_message(content_hash, secret, aztec_l1_adapter, bridge_message_leaf_index);
        storage.root_history.at(root).initialize(root_type);
        if (root_type == GIGA_ROOT) {
            storage.giga_root.write(root);
        }
    }
}
