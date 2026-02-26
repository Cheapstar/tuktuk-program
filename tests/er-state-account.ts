import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import {
  GetCommitmentSignature,
  MAGIC_CONTEXT_ID,
  MAGIC_PROGRAM_ID,
} from "@magicblock-labs/ephemeral-rollups-sdk";
import { ErStateAccount } from "../target/types/er_state_account";
import {
  init,
  taskKey,
  taskQueueAuthorityKey,
  TUKTUK_CONFIG,
} from "@helium/tuktuk-sdk";
import { SYSTEM_PROGRAM_ID } from "@coral-xyz/anchor/dist/cjs/native/system";
import { assert } from "chai";

const DEFAULT_QUEUE = new PublicKey(
  "Cuj97ggrhhidhbu39TijNVqE74xvKJ69gDervRUXAxGh",
);

const DEFAULT_EPHEMERAL_QUEUE = new PublicKey(
  "5hBR571xnXppuCPveTrctfTU7tJLSN94nq7kv7FRK5Tc",
);

describe("Tuk Tuk Program", async () => {
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

  const program = anchor.workspace.erStateAccount as Program<ErStateAccount>;

  const taskQueue = new anchor.web3.PublicKey(
    "HLSqqy3bSiFnXjCtpAk8wcRX7AYRT61Zwh1AKMdYWaY5",
  );

  // one which has authority of adding tasks into queue
  const queueAuthority = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("queue_authority")],
    program.programId,
  )[0];

  // this is like a ticket for a queue and queueAuthority
  const taskQueueAuthority = taskQueueAuthorityKey(
    taskQueue,
    queueAuthority,
  )[0];

  // fuckin State which needs to updated
  const userAccount = anchor.web3.PublicKey.findProgramAddressSync(
    [Buffer.from("user"), anchor.Wallet.local().publicKey.toBuffer()],
    program.programId,
  )[0];

  console.log("Task Queue : ", taskQueue.toString());
  console.log("Queue Authority : ", queueAuthority.toString());
  console.log("Task Queue Authority : ", taskQueueAuthority.toString());

  before(async function () {
    const balance = await provider.connection.getBalance(
      anchor.Wallet.local().publicKey,
    );

    console.log("Current balance is", balance / LAMPORTS_PER_SOL, " SOL", "\n");
    // Check does user_account_exists if yes then undelegate it and delete it
    const user_account = await provider.connection.getAccountInfo(userAccount);

    const randomValue = new anchor.BN(user_account.data.slice(40, 48), "le");
    console.log("  Random value :", randomValue.toString());

    if (user_account) {
      // this goes to ER and then onchain is updated
      let info = await providerEphemeralRollup.connection.getAccountInfo(
        userAccount,
      );

      console.log("User Account Info: ", info);

      console.log("User account", userAccount.toBase58());

      let undelegate_tx = await program.methods
        .undelegate()
        .accounts({
          user: providerEphemeralRollup.wallet.publicKey,
        })
        .transaction();

      undelegate_tx.feePayer = providerEphemeralRollup.wallet.publicKey;

      undelegate_tx.recentBlockhash = (
        await providerEphemeralRollup.connection.getLatestBlockhash()
      ).blockhash;
      undelegate_tx = await providerEphemeralRollup.wallet.signTransaction(
        undelegate_tx,
      );
      const txHash = await providerEphemeralRollup.sendAndConfirm(
        undelegate_tx,
        [],
        {
          skipPreflight: false,
        },
      );
      const txCommitSgn = await GetCommitmentSignature(
        txHash,
        providerEphemeralRollup.connection,
      );

      console.log("\nUser Account Undelegated: ", txHash);

      const account = await program.account.userAccount.fetch(userAccount);
      console.log("Random value :", account.data.toString());

      const close_tx = await program.methods
        .close()
        .accountsPartial({
          user: anchor.Wallet.local().publicKey,
          userAccount: userAccount,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();
      console.log("\nUser Account Closed: ", close_tx);
    }
  });
  it("Checking the working of Program , init , update onchain , delegating", async () => {
    // initializing the program
    // creates a state
    const init_tx = await program.methods
      .initialize()
      .accountsPartial({
        user: anchor.Wallet.local().publicKey,
        userAccount: userAccount,
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc();
    console.log("User Account initialized: ", init_tx);

    // this happens directly to on-chain
    // we give the 2 as the seeds for randomness
    const update_tx = await program.methods
      .updateUser(new anchor.BN(10))
      .accountsPartial({
        user: anchor.Wallet.local().publicKey,
        userAccount: userAccount,
      })
      .rpc({ skipPreflight: true });
    console.log(
      "\n [ONCHAIN] User Account State Updated Manually: ",
      update_tx,
    );

    const account = await program.account.userAccount.fetch(userAccount);
    const user_account_data = account.data.toString();
    console.log("Updated State : ,", user_account_data);

    // this is for randomized update so for this we use default oracle queue
    const randomize_update_tx = await program.methods
      .requestRandomness(2)
      .accountsPartial({
        user: anchor.Wallet.local().publicKey,
        userAccount: userAccount,
        oracleQueue: DEFAULT_QUEUE,
      })
      .rpc({ skipPreflight: true });
    console.log(
      "\n [ONCHAIN] User Account State Updated Randomized : ",
      randomize_update_tx,
    );
    await new Promise((resolve) => setTimeout(resolve, 5000));

    console.log(
      "Updated State : ,",
      (await program.account.userAccount.fetch(userAccount)).data.toString(),
    );
  });
  // ---
  it("Schedule the Commit 100s from now", async () => {
    try {
      let tuktukProgram = await init(provider);

      let task_id = 4;
      let tx = await program.methods
        .schedule(task_id)
        .accountsPartial({
          user: anchor.Wallet.local().publicKey,
          userAccount: userAccount,
          taskQueue: taskQueue,
          taskQueueAuthority: taskQueueAuthority,
          task: taskKey(taskQueue, task_id)[0],
          queueAuthority: queueAuthority,
          magicContext: MAGIC_CONTEXT_ID,
          magicProgram: MAGIC_PROGRAM_ID,
          systemProgram: SYSTEM_PROGRAM_ID,
          tuktukProgram: tuktukProgram.programId,
        })
        .signers([anchor.Wallet.local().payer])
        .transaction();

      tx.feePayer = anchor.Wallet.local().publicKey; // <-- ADD THIS
      tx.recentBlockhash = (
        await provider.connection.getLatestBlockhash()
      ).blockhash;
      tx = await provider.wallet.signTransaction(tx);
      const txHash = await provider.sendAndConfirm(tx, [], {
        skipPreflight: false,
      });

      assert(
        tuktukProgram.programId.equals(
          new anchor.web3.PublicKey(
            "tuktukUrfhXT6ZT77QTU8RQtvgL967uRuVagWF57zVA",
          ),
        ),
      );
      console.log("\nUser Account State Updated: ", txHash);
    } catch (error) {
      console.log("\nFull error:", error);
      if (error.logs) {
        console.log("\nTransaction logs:");
        error.logs.forEach((log) => console.log(log));
      }
      throw error;
    }
  });

  it("Delegating the Program ", async () => {
    console.log("[Delegating] the State to ER ");
    // This delegates the user account to the ER
    let delegate_tx = await program.methods
      .delegate()
      .accountsPartial({
        user: anchor.Wallet.local().publicKey,
        userAccount: userAccount,
        validator: new PublicKey("MAS1Dt9qreoRMQ14YQuhg8UTZMMzDdKhmkZMECCzk57"),
        systemProgram: anchor.web3.SystemProgram.programId,
      })
      .rpc({ skipPreflight: true });

    console.log("\nUser Account Delegated to Ephemeral Rollup: ", delegate_tx);
  });

  let expected_value = "";

  it("Updating the User Account", async () => {
    // This is taken by ER cause userAccount is included and then commited to base layer
    const ephemeral_program = new anchor.Program(
      program.idl,
      providerEphemeralRollup,
    );

    let update_on_er_tx = await ephemeral_program.methods
      .requestRandomness(2)
      .accountsPartial({
        user: anchor.Wallet.local().publicKey,
        userAccount: userAccount,
        oracleQueue: DEFAULT_QUEUE,
      })
      .transaction();

    update_on_er_tx.feePayer = providerEphemeralRollup.wallet.publicKey;

    update_on_er_tx.recentBlockhash = (
      await providerEphemeralRollup.connection.getLatestBlockhash()
    ).blockhash;
    update_on_er_tx = await providerEphemeralRollup.wallet.signTransaction(
      update_on_er_tx,
    );
    const update_on_er_tx_hash = await providerEphemeralRollup.sendAndConfirm(
      update_on_er_tx,
      [],
      {
        skipPreflight: false,
      },
    );

    console.log("\nUser Account State Updated: ", update_on_er_tx_hash);

    // poll until randomness is non-zero (oracle fulfilled it)
    let randomValue = new anchor.BN(0);
    for (let i = 0; i < 20; i++) {
      await new Promise((resolve) => setTimeout(resolve, 3000));
      const userAccountInfo =
        await providerEphemeralRollup.connection.getAccountInfo(userAccount);
      if (userAccountInfo) {
        randomValue = new anchor.BN(userAccountInfo.data.slice(40, 48), "le");
        console.log(
          `  [Poll ${i + 1}] Random value: ${randomValue.toString()}`,
        );
        if (randomValue.toNumber() !== 0) break;
      }
    }

    assert(
      randomValue.toNumber() !== 0,
      "Oracle never fulfilled randomness on ER",
    );
    expected_value = randomValue.toString();
    console.log("  Captured expected value:", expected_value);
  });

  it("delaying 100s and checking it at the ONCHAIN ", async () => {
    await delay(200000);

    const userAccountInfo = await provider.connection.getAccountInfo(
      userAccount,
    );

    const randomValue = new anchor.BN(userAccountInfo.data.slice(40, 48), "le");
    console.log("  Random value :", randomValue.toString());
    assert(
      expected_value === randomValue.toString(),
      "Value Should have been updated",
    );
  });
});

const delay = (ms: number): Promise<void> => {
  return new Promise((resolve) => setTimeout(resolve, ms));
};
