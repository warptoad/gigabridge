# gigabridge contracts

yay!

## install
```shell
pnpm install
```

## compile and deploy  
compile and create creat2 artifacts  
```shell
pnpm hardhat gen-artifact-create2 --network sepolia;
```

mine salt (takes 10 min)  
```shell
pnpm hardhat mine-create2 --zeros 2 --suffix 919A
```

deploy and verify  
```shell
pnpm hardhat deploy-create2 --network sepolia;
pnpm hardhat verify-create2 --network sepolia;
```

TODO here and in skinny-fat-imt-js, mare create2-salts.json do {[contractName]:{[address]:salt}}