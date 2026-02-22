use anchor_lang::prelude::*;

use crate::state::UserAccount;

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