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
});
