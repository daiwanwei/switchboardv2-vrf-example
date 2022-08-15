import {AccountClient, AnchorProvider, BorshCoder, Program, Wallet} from "@project-serum/anchor";
import {clusterApiUrl, Connection, Keypair, PublicKey} from "@solana/web3.js";
import {IDL, Switchboardv2VrfExample} from "./idl/switchboardv2_vrf_example";
import {getKeypairFromFile} from "./utils";
import {PROGRAM_ID} from "./idl/common";
import {
    createPermissionAccountFromSwitchboard,
    createVrfAccountFromSwitchboard, createVrfClientAccount,
    getSwitchboardContext, requestResultFromSwitchboard, waitResult
} from "./usecase";

async function main() {
    const keyFilepath = "/Users/daiwanwei/Projects/daiwanwei-github/switchboardv2-vrf-example/secrets/payer-keypair.json"
    const payer = getKeypairFromFile(keyFilepath)
    const wallet = new Wallet(payer)
    const connection = new Connection(clusterApiUrl("devnet"), 'confirmed')
    const provider = new AnchorProvider(connection, wallet, AnchorProvider.defaultOptions())
    console.log(`your wallet publickey is ${provider.wallet.publicKey.toBase58()}`)
    const program = new Program(
        IDL,
        PROGRAM_ID,
        provider,
        new BorshCoder(IDL)
    ) as Program<Switchboardv2VrfExample>;
    const switchboard = await getSwitchboardContext(provider)
    const vrfSecret = Keypair.generate();
    const [vrfClientKey, vrfClientBump] =
        PublicKey.findProgramAddressSync(
            [
                Buffer.from("STATE"),
                vrfSecret.publicKey.toBytes(),
                payer.publicKey.toBytes(),
            ],
            new PublicKey(PROGRAM_ID)
        );
    //1. 向switchboard program 建立 vrfAccount 的pda
    const vrfAccount = await createVrfAccountFromSwitchboard(
        provider, switchboard, vrfSecret, vrfClientKey
    );
    //2. 向switchboard program 建立 permissionAccount 的pda
    const permissionAccount = await createPermissionAccountFromSwitchboard(
        provider, switchboard, vrfAccount
    );
    //3. 向 program 建立 vrfClientAccount 的pda
    await createVrfClientAccount(
        provider, program, vrfClientKey, vrfAccount,
    );
    //4. 請求亂數
    await requestResultFromSwitchboard(
        provider, program, switchboard, vrfClientKey, vrfAccount, permissionAccount
    )
    //4. 等待亂數回傳結果
    const result=await waitResult(provider, program, vrfClientKey, 55_000)
    console.log(`VrfClient Result: ${result}`);
}

main()
    .then(() => console.log(`execute successfully`))
    .catch((err) => console.log(`execute fail,err:${err}`))
.finally(() => process.exit());