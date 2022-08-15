# switchboardv2-vrf-example
## Table of Contents

* [專案描述](#專案描述)
* [執行專案](#執行專案)

## 專案描述



## 執行專案

### Installation
```shell
yarn install
```

### Compile program
```shell
#編譯program,編譯後在target裡
$ anchor build
# 取得program id
$ solana-keygen pubkey target/deploy/switchboardv2_vrf_example-keypair.json
# 更新program id,Anchor.toml和lib.rs內都必須更改
```

### Deploy program(devnet)
```shell
#啟動測試練
$ solana-keygen new --outfile secrets/payer-keypair.json
#部署program
$ anchor deploy
```

### Test program
```shell
$ anchor test
```