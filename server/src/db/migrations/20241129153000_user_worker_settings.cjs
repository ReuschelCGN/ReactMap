/* eslint-disable no-unused-vars */
const config = require('@rm/config')

/**
 * @param {import("knex").Knex} knex
 */
exports.up = async (knex) => {
  // Create user_settings table for worker configuration
  await knex.schema.createTable('user_settings', (table) => {
    table.string('user_id', 255).primary().comment('User identifier (discord_id, telegram_id, or username)')
    table.integer('max_workers').defaultTo(3).notNullable().comment('Maximum workers this user can assign')
    table.integer('max_fences').defaultTo(3).notNullable().comment('Maximum fences this user can create')
    table.timestamps(true, true)
  })
}

/**
 * @param {import("knex").Knex} knex
 */
exports.down = async (knex) => {
  await knex.schema.dropTableIfExists('user_settings')
}
