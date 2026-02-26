#![allow(unexpected_cfgs)]
#![allow(deprecated)]

use anchor_lang::prelude::*;
use ephemeral_rollups_sdk::anchor::ephemeral;

mod state;
mod instructions;

use instructions::*;

declare_id!("5KCEjLFXjrp7b8xTDqEeU4k44YbQmmBzuKs84R35GGzG");

#[ephemeral]
#[program]
pub mod er_state_account {

    use super::*;

    pub fn initialize(ctx: Context<InitUser>) -> Result<()> {
        ctx.accounts.initialize(&ctx.bumps)?;
        
        Ok(())
    }

    pub fn update_user(ctx:Context<UpdateUser>,new_data:u64)->Result<()>{
        ctx.accounts.update(new_data)?;
        Ok(())
    }

    // So Basically ye jo data store karna hai wo random hona chaiye using VRF , hai na ?
    // Idea is ki hum pehle request bhejenge for the random data and the callback ko 
    // define karna hai which will take care of saving the data
    pub fn request_randomness(ctx: Context<RequestRandomness>,client_seed:u8) -> Result<()> {
        ctx.accounts.request_randomness(client_seed)?;
        
        Ok(())
    }

    pub fn callback_update(ctx:Context<CallbackUpdate>,randomness: [u8; 32])->Result<()> {
        ctx.accounts.callback_update(randomness)?;
        Ok(())
    }

    pub fn update_commit(ctx: Context<UpdateCommit>) -> Result<()> {
        ctx.accounts.update_commit()?;
        
        Ok(())
    }

    pub fn delegate(ctx: Context<Delegate>) -> Result<()> {
        ctx.accounts.delegate()?;
        
        Ok(())
    }

    pub fn undelegate(ctx: Context<Undelegate>) -> Result<()> {
        ctx.accounts.undelegate()?;
        
        Ok(())
    }

    pub fn close(ctx: Context<CloseUser>) -> Result<()> {
        ctx.accounts.close()?;
        
        Ok(())
    }

    pub fn schedule(ctx:Context<Schedule>,task_id:u16)->Result<()> {
        ctx.accounts.schedule(task_id, ctx.bumps)?;
        Ok(())
    }
}

