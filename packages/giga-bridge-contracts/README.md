# giga-bridge contracts

yay!

## install
```shell
yarn install
```

## compile poseidon2 huff
```shell
huffc node_modules/poseidon2-evm/src/huff/Poseidon2.huff --artifacts -o ./huff_artifacts/
```


## compile aztec
```shell
cd contracts/adapters/aztec/aztec_adapter_l2
aztec-nargo compile;
aztec-postprocess-contract
aztec codegen -o src/artifacts target;
cd ../../../..
```