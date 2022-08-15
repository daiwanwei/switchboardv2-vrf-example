import {AnchorProvider, BN, BorshAccountsCoder, BorshInstructionCoder, Program} from "@project-serum/anchor";
import {IDL, Switchboardv2VrfExample} from "./idl/switchboardv2_vrf_example";
import {promiseWithTimeout, SwitchboardTestContext} from "@switchboard-xyz/sbv2-utils";
import {
    AccountInfo, Commitment,
    Context,
    Keypair,
    PublicKey,
    SystemProgram,
    SYSVAR_RECENT_BLOCKHASHES_PUBKEY
} from "@solana/web3.js";
import {
    AnchorWallet,
    Callback,
    PermissionAccount, ProgramStateAccount,
    SwitchboardPermission,
    VrfAccount
} from "@switchboard-xyz/switchboard-v2";
import {PROGRAM_ID} from "./idl/common";
// @ts-ignore
import {getOrCreateAssociatedTokenAccount, TOKEN_PROGRAM_ID} from "@solana/spl-token";


export async function getSwitchboardContext(provider:AnchorProvider):Promise<SwitchboardTestContext>{
    const switchboard=await SwitchboardTestContext.loadDevnetQueue(
        provider,
        "F8ce7MsckeZAbAGmxjJNetxYXQa9mKr9nnrC3qKubyYy",
        5_000_000 // .005 wSOL
    );
    return switchboard;

}

export async function createVrfAccountFromSwitchboard(
    provider:AnchorProvider,
    switchboard:SwitchboardTestContext,
    vrfSecret:Keypair,
    vrfClientKey:PublicKey
):Promise<VrfAccount>{
    const queue = switchboard.queue;
    //產生switchboard callback 資訊
    const vrfClientCallback=generateCallback(switchboard,vrfClientKey,vrfSecret);
    // Create Switchboard VRF and Permission account
    const vrfAccount = await VrfAccount.create(switchboard.program, {
        queue,
        callback: vrfClientCallback,
        authority: vrfClientKey, // vrf authority
        keypair: vrfSecret,
    });

    console.log(`Created VRF Account: ${vrfAccount.publicKey}`);
    return vrfAccount;
}

export async function createPermissionAccountFromSwitchboard(
    provider:AnchorProvider,
    switchboard:SwitchboardTestContext,
    vrfAccount:VrfAccount,
):Promise<PermissionAccount>{
    const payer=(provider.wallet as AnchorWallet).payer;
    const queue = switchboard.queue;
    const { unpermissionedVrfEnabled, authority, dataBuffer } =
        await queue.loadData();
    const permissionAccount = await PermissionAccount.create(
        switchboard.program,
        {
            authority,
            granter: queue.publicKey,
            grantee: vrfAccount.publicKey,
        }
    );
    console.log(`Created Permission Account: ${permissionAccount.publicKey}`);

    // If queue requires permissions to use VRF, check the correct authority was provided
    if (!unpermissionedVrfEnabled) {
        if (!payer.publicKey.equals(authority)) {
            throw new Error(
                `queue requires PERMIT_VRF_REQUESTS and wrong queue authority provided`
            );
        }

        await permissionAccount.set({
            authority: payer,
            permission: SwitchboardPermission.PERMIT_VRF_REQUESTS,
            enable: true,
        });
        console.log(`Set VRF Permissions`);
    }
    return permissionAccount;
}

export async function createVrfClientAccount(
    provider :AnchorProvider,
    program:Program<Switchboardv2VrfExample>,
    vrfClientKey:PublicKey,
    vrfAccount:VrfAccount,
){
    const payer=(provider.wallet as AnchorWallet).payer;
    // Create VRF Client account
    await program.methods
        .initState({
            maxResult: new BN(1337000),
        })
        .accounts({
            state: vrfClientKey,
            vrf: vrfAccount.publicKey,
            payer: payer.publicKey,
            authority: payer.publicKey,
            systemProgram: SystemProgram.programId,
        })
        .rpc({commitment: "confirmed"});
    console.log(`Created VrfClient Account: ${vrfClientKey}`);
}

export async function requestResultFromSwitchboard(
    provider :AnchorProvider,
    program:Program<Switchboardv2VrfExample>,
    switchboard:SwitchboardTestContext,
    vrfClientKey:PublicKey,
    vrfAccount:VrfAccount,
    permissionAccount:PermissionAccount,
) {
    const payer = (provider.wallet as AnchorWallet).payer;
    const queue = switchboard.queue;
    const {unpermissionedVrfEnabled, authority, dataBuffer} =
        await queue.loadData();
    // Get required switchboard accounts
    const [programStateAccount, programStateBump] =
        ProgramStateAccount.fromSeed(switchboard.program);
    const [permissionKey, permissionBump] = PermissionAccount.fromSeed(
        switchboard.program,
        authority,
        queue.publicKey,
        vrfAccount.publicKey
    );
    const mint = await programStateAccount.getTokenMint();
    const payerTokenAccount = await getOrCreateAssociatedTokenAccount(
        provider.connection,
        payer,
        mint.address,
        payer.publicKey
    );

    const {escrow} = await vrfAccount.loadData();

    // Request randomness
    await program.methods.requestResult!({
        switchboardStateBump: programStateBump,
        permissionBump,
    })
        .accounts({
            state: vrfClientKey,
            authority: payer.publicKey,
            switchboardProgram: switchboard.program.programId,
            vrf: vrfAccount.publicKey,
            oracleQueue: queue.publicKey,
            queueAuthority: authority,
            dataBuffer,
            permission: permissionAccount.publicKey,
            escrow,
            payerWallet: payerTokenAccount.address,
            payerAuthority: payer.publicKey,
            recentBlockhashes: SYSVAR_RECENT_BLOCKHASHES_PUBKEY,
            programState: programStateAccount.publicKey,
            tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc({commitment: "confirmed"});
    console.log(`request result successfully!`);
}

export async function waitResult(
    provider :AnchorProvider,
    program:Program<Switchboardv2VrfExample>,
    vrfClientKey:PublicKey,
    timeoutInterval: number,
) :Promise<BN>{
    let ws: number | undefined = undefined;
    const result: BN = await promiseWithTimeout(
        timeoutInterval,
        new Promise(
            (
                resolve: (result: BN) => void,
                reject: (reason: string) => void
            ) => {
                ws = provider.connection.onAccountChange(
                    vrfClientKey,
                    async (
                        accountInfo: AccountInfo<Buffer>,
                        context: Context
                    ) => {
                        const coder=new BorshAccountsCoder(IDL)
                        const clientState = coder.decode("vrfClient",accountInfo.data);
                        if (clientState.result.gt(new BN(0))) {
                            resolve(clientState.result);
                        }
                    }
                );
            }
        ).finally(async () => {
            if (ws) {
                await provider.connection.removeAccountChangeListener(ws);
            }
            ws = undefined;
        }),
        new Error("Timed out waiting for VRF Client callback")
    ).finally(async () => {
        if (ws) {
            await provider.connection.removeAccountChangeListener(ws);
        }
        ws = undefined;
    });

    return result;
}

function generateCallback(
    switchboard:SwitchboardTestContext,vrfClientKey:PublicKey,vrfSecret:Keypair
):Callback{
    const vrfIxCoder = new BorshInstructionCoder(IDL);
    const vrfClientCallback = {
        programId: new PublicKey(PROGRAM_ID),
        accounts: [
            // ensure all accounts in updateResult are populated
            { pubkey: vrfClientKey, isSigner: false, isWritable: true },
            { pubkey: vrfSecret.publicKey, isSigner: false, isWritable: false },
        ],
        ixData: vrfIxCoder.encode("updateResult", ""), // pass any params for instruction here
    };
    return vrfClientCallback;
}
