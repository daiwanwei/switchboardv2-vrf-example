import * as anchor from "@project-serum/anchor";
import { Program } from "@project-serum/anchor";
import { Switchboardv2VrfExample } from "../target/types/switchboardv2_vrf_example";

describe("switchboardv2-vrf-example", () => {
  // Configure the client to use the local cluster.
  anchor.setProvider(anchor.AnchorProvider.env());

  const program = anchor.workspace.Switchboardv2VrfExample as Program<Switchboardv2VrfExample>;

  it("Is initialized!", async () => {
    // Add your test here.
    // const tx = await program.methods.initialize().rpc();
    // console.log("Your transaction signature", tx);
  });
});
