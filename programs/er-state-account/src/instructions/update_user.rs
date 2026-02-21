use anchor_lang::prelude::*;
use ephemeral_vrf_sdk::{anchor::vrf, instructions::{RequestRandomnessParams, create_request_randomness_ix}, types::SerializableAccountMeta};

use crate::{instruction, instructions, state::UserAccount};

// This vrf account must have oracle queue which does some offchain computation
// This is we are doing inside the ER ?
#[vrf]
#[derive(Accounts)]
pub struct UpdateUser<'info> {
    pub user: Signer<'info>,
    #[account(
        mut,
        seeds = [b"user", user.key().as_ref()],
        bump = user_account.bump,
    )]
    pub user_account: Account<'info, UserAccount>,
    /// CHECK: The oracle queue
    #[account(mut, address = ephemeral_vrf_sdk::consts::DEFAULT_QUEUE)]
    pub oracle_queue: AccountInfo<'info>,
}

impl<'info> UpdateUser<'info> {
    pub fn update(&mut self,client_seed:u8) -> Result<()> {

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
                is_writable:false
            }]),
            ..Default::default()
        });     

        self.invoke_signed_vrf(&self.user.to_account_info(), &ix)?;   
        Ok(())
    }
}

#[derive(Accounts)]
pub struct CallbackUpdate<'info> {
    #[account(address = ephemeral_vrf_sdk::consts::VRF_PROGRAM_IDENTITY)]
    pub vrf_program_identity: Signer<'info>,
    #[account(mut)]
    pub user_account:Account<'info,UserAccount>
}   

impl<'info> CallbackUpdate<'info> {
    pub fn callback_update(&mut self, randomness: [u8; 32])->Result<()>{
        let rnd_u8 = ephemeral_vrf_sdk::rnd::random_u8_with_range(&randomness, 1, 6);
        msg!("Consuming random number: {:?}", rnd_u8);
        self.user_account.data = rnd_u8 as u64;
        Ok(())
    }
}