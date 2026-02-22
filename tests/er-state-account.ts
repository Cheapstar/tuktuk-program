import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { GetCommitmentSignature } from "@magicblock-labs/ephemeral-rollups-sdk";
import { ErStateAccount } from "../target/types/er_state_account";

const DEFAULT_QUEUE = new PublicKey(
  "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
);

const DEFAULT_EPHEMERAL_QUEUE = new PublicKey(
  "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc",
);

describe("er-state-account", () => {
  // Configure the client to use the local cluster.
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const providerEphemeralRollup = new anchor.AnchorProvider(
    new anchor.web3.Connection(
      process.env.EPHEMERAL_PROVIDER_ENDPOINT ||
        "https://devnet-as.magicblock.app/",
      {
        wsEndpoint:
          process.env.EPHEMERAL_WS_ENDPOINT ||
          "wss://devnet-as.magicblock.app/",
      },
    ),
    anchor.Wallet.local(),
  );
  console.log("Base Layer Connection: ", provider.connection.rpcEndpoint);
  console.log(
    "Ephemeral Rollup Connection: ",
    providerEphemeralRollup.connection.rpcEndpoint,
  );
  console.log(`Current SOL Public Key: ${anchor.Wallet.local().publicKey}`);

  before(async function () {
    const balance = await provider.connection.getBalance(
      anchor.Wallet.local().publicKey,
    );
    console.log("Current balance is", balance / LAMPORTS_PER_SOL, " SOL", "\n");
  });

  const program = anchor.workspace.erStateAccount as Program<ErStateAccount>;

  const userAccount = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("user"), anchor.Wallet.local().publicKey.toBuffer()],
    program.programId,
  )[0];

  it("Is initialized!", async () => {
    const tx = await program.methods
      .initialize()
      .accountsPartial({
        user: anchor.Wallet.local().publicKey,
        userAccount: userAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("User Account initialized: ", tx);
  });

  it("[Task 1] : Update State Outside the ER ", async () => {
    // this happens directly to on-chain
    // we give the 2 as the seeds for randomness
    const tx = await program.methods
      .update(10)
      .accountsPartial({
        user: anchor.Wallet.local().publicKey,
        userAccount: userAccount,
        oracleQueue: DEFAULT_QUEUE,
      })
      .rpc({ skipPreflight: true });
    console.log("\nUser Account State Updated: ", tx);

    await new Promise((resolve) => setTimeout(resolve, 5_000));

    const account = await program.account.userAccount.fetch(userAccount);
    const user_account_data = account.data.toString();
    console.log("Updated State Using Randomness ,", user_account_data);
  });

  it("Delegate to Ephemeral Rollup!", async () => {
    // This delegates the user account to the ER
    let tx = await program.methods
      .delegate()
      .accountsPartial({
        user: anchor.Wallet.local().publicKey,
        userAccount: userAccount,
        validator: new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc({ skipPreflight: true });

    console.log("\nUser Account Delegated to Ephemeral Rollup: ", tx);
  });

  it("[Task 2] : Update State Inside The ER", async () => {
    // This is taken by ER cause userAccount is included and then commited to base layer
    const ephemeral_program = new anchor.Program(
      program.idl,
      providerEphemeralRollup,
    );

    let tx = await ephemeral_program.methods
      .update(2)
      .accountsPartial({
        user: providerEphemeralRollup.wallet.publicKey,
        userAccount: userAccount,
        oracleQueue: DEFAULT_EPHEMERAL_QUEUE,
      })
      .transaction();

    tx.feePayer = providerEphemeralRollup.wallet.publicKey;

    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [], {
      skipPreflight: false,
    });

    console.log("\nUser Account State Updated: ", txHash);

    // await new Promise((resolve) => setTimeout(resolve, 5_000));

    const accountInfo = await providerEphemeralRollup.connection.getAccountInfo(
      userAccount,
    );

    // Why is this always coming as 0 ??
    // Okay so we were checking it on the main chain before , so now we are checking it on ER
    if (accountInfo) {
      const randomValue = new anchor.BN(accountInfo.data.slice(40, 48), "le");
      console.log("  Random value :", randomValue.toString());
    }
  });

  it("Update State and Commit to Base Layer!", async () => {
    // This is taken by ER cause userAccount is included and then commited to base layer
    const ephemeral_program = new anchor.Program(
      program.idl,
      providerEphemeralRollup,
    );

    let tx = await ephemeral_program.methods
      .updateCommit(new anchor.BN(43))
      .accountsPartial({
        user: providerEphemeralRollup.wallet.publicKey,
        userAccount: userAccount,
      })
      .transaction();

    tx.feePayer = providerEphemeralRollup.wallet.publicKey;

    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [], {
      skipPreflight: false,
    });
    const txCommitSgn = await GetCommitmentSignature(
      txHash,
      providerEphemeralRollup.connection,
    );

    console.log("\nUser Account State Updated: ", txHash);

    // await new Promise((resolve) => setTimeout(resolve, 5_000));

    const accountInfo = await providerEphemeralRollup.connection.getAccountInfo(
      userAccount,
    );

    // Why is this always coming as 0 ??
    // Okay so we were checking it on the main chain before , so now we are checking it on ER
    if (accountInfo) {
      const randomValue = new anchor.BN(accountInfo.data.slice(40, 48), "le");
      console.log("  Random value :", randomValue.toString());
    }
  });

  it("Commit and undelegate from Ephemeral Rollup!", async () => {
    // this goes to ER and then onchain is updated
    let info = await providerEphemeralRollup.connection.getAccountInfo(
      userAccount,
    );

    console.log("User Account Info: ", info);

    console.log("User account", userAccount.toBase58());

    let tx = await program.methods
      .undelegate()
      .accounts({
        user: providerEphemeralRollup.wallet.publicKey,
      })
      .transaction();

    tx.feePayer = providerEphemeralRollup.wallet.publicKey;

    tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    tx = await providerEphemeralRollup.wallet.signTransaction(tx);
    const txHash = await providerEphemeralRollup.sendAndConfirm(tx, [], {
      skipPreflight: false,
    });
    const txCommitSgn = await GetCommitmentSignature(
      txHash,
      providerEphemeralRollup.connection,
    );

    console.log("\nUser Account Undelegated: ", txHash);

    const account = await program.account.userAccount.fetch(userAccount);
    console.log("Random value :", account.data.toString());
  });

  it("Update State!", async () => {
    // This happens on-chain
    let tx = await program.methods
      .update(2)
      .accountsPartial({
        user: anchor.Wallet.local().publicKey,
        userAccount: userAccount,
        oracleQueue: DEFAULT_QUEUE,
      })
      .rpc();

    console.log("\nUser Account State Updated: ", tx);
  });

  it("Close Account!", async () => {
    // this happens on chain
    const tx = await program.methods
      .close()
      .accountsPartial({
        user: anchor.Wallet.local().publicKey,
        userAccount: userAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("\nUser Account Closed: ", tx);
  });
});
