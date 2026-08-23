# gigabridge contracts

yay!

## install
```shell
pnpm install
```

## compile and deploy  
compile and create creat2 artifacts  
```shell
pnpm hardhat compile;
pnpm hardhat gen-artifact-create2 --network sepolia;
```

mine salt (takes 20 min)  
```shell
# for mainnet i would go for 4 leading zeros and suffix=0919A, so it truncates to 0x0000...0919A
pnpm hardhat mine-create2 --zeros 2 --match-case --suffix 0919A
```

deploy and verify  
```shell
pnpm hardhat deploy-create2 --network sepolia;
pnpm hardhat verify-create2 --network sepolia;
```

TODO here and in skinny-fat-imt-js, mare create2-salts.json do {[contractName]:{[address]:salt}}