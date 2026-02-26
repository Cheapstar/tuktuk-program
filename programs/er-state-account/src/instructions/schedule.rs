
use std::{str::FromStr, time::UNIX_EPOCH};

use anchor_lang::{InstructionData, prelude::{ *}};
use anchor_lang::solana_program::instruction::Instruction;
use tuktuk_program:: {
    TransactionSourceV0, TriggerV0, compile_transaction, tuktuk::{cpi::{accounts::QueueTaskV0, queue_task_v0}, program::Tuktuk}, types::QueueTaskArgsV0
};
use crate::state::UserAccount;



#[derive(Accounts)]
pub struct Schedule<'info> {
    #[account(
        mut,
    )]
    pub user:Signer<'info>,

    #[account(
        mut
    )]
    pub user_account:Account<'info,UserAccount>,

    #[account(mut)]
    /// CHECK: Don't need to parse this account, just using it in CPI
    pub task_queue:UncheckedAccount<'info>,
    /// CHECK: Don't need to parse this account, just using it in CPI
    pub task_queue_authority:UncheckedAccount<'info>,
    #[account(mut)]
    /// CHECK: Initialized in CPI
    pub task:UncheckedAccount<'info>,

    /// CHECK: Via seeds
    #[account(
        mut,
        seeds = [b"queue_authority"],
        bump
    )]   
    pub queue_authority:AccountInfo<'info>,

    #[account(mut, address = ephemeral_rollups_sdk::consts::MAGIC_CONTEXT_ID)]
    /// CHECK:`
    pub magic_context: AccountInfo<'info>,
    pub magic_program: Program<'info, ephemeral_rollups_sdk::anchor::MagicProgram>,

    pub system_program:Program<'info,System>,
    pub tuktuk_program:Program<'info,Tuktuk>
}


impl<'info> Schedule<'info> {
    pub fn schedule(&mut self, task_id:u16, bumps: ScheduleBumps)->Result<()>{
        let curr_time = Clock::get()?.unix_timestamp;

        let (compile_tx,_) = compile_transaction(
            vec![
                Instruction {
                    program_id: crate::ID,
                    accounts: crate::__cpi_client_accounts_update_commit:: UpdateCommit {
                        user_account:self.user_account.to_account_info(),
                        user:self.user.to_account_info(),
                        magic_context: self.magic_context.to_account_info(),
                        magic_program:self.magic_program.to_account_info()
                    }.to_account_metas(Some(true))
                    .to_vec(),
                    data:crate::instruction::UpdateCommit{}.data()
                }
            ], vec![]).unwrap();


            queue_task_v0(
                CpiContext::new_with_signer(
                self.tuktuk_program.to_account_info(), 
                QueueTaskV0 {
                    payer: self.user.to_account_info(),
                    queue_authority: self.queue_authority.to_account_info(),
                    task_queue_authority: self.task_queue_authority.to_account_info(),
                    task_queue: self.task_queue.to_account_info(),
                    task: self.task.to_account_info(),
                    system_program: self.system_program.to_account_info(),
                }, 
                &[&[b"queue_authority",&[bumps.queue_authority]]]
            ), 
            QueueTaskArgsV0 {
                id: task_id,
                trigger: TriggerV0::Timestamp(curr_time.checked_add(100).unwrap()),
                transaction: TransactionSourceV0::CompiledV0(compile_tx),
                crank_reward: Some(1000001),
                free_tasks: 1,
                description: "test".to_string(),
            }
        )?;


        Ok(())
    }
}