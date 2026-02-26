use anchor_lang::prelude::*;
use ephemeral_vrf_sdk::{anchor::vrf, instructions::{RequestRandomnessParams, create_request_randomness_ix}, types::SerializableAccountMeta};

use crate::{instruction, instructions, state::UserAccount};

// This vrf account must have oracle queue which does some offchain computation
// This is we are doing inside the ER ?
#[vrf]
#[derive(Accounts)]
pub struct RequestRandomness<'info> {
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"user", user.key().as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,
    /// CHECK: The oracle queue
    #[account(mut)]
    pub oracle_queue: AccountInfo<'info>,
}

impl<'info> RequestRandomness<'info> {
    pub fn request_randomness(&mut self,client_seed:u8) -> Result<()> {

        // Update the data field
        msg!("Requesting for Random Data");
        let ix = create_request_randomness_ix(RequestRandomnessParams {
            payer: self.user.key(),
            oracle_queue: self.oracle_queue.key(),
            callback_program_id: crate::ID,
            callback_discriminator: crate::instruction::CallbackUpdate::DISCRIMINATOR.to_vec(),
            caller_seed: [client_seed;32],
            accounts_metas: Some(vec![SerializableAccountMeta {
                pubkey:self.user_account.key(),
                is_signer:false,
                is_writable:true
            }]),
            ..Default::default()
        });     

        self.invoke_signed_vrf(&self.user.to_account_info(), &ix)?;   
        Ok(())
    }
}
