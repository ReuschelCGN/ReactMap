// @ts-check
const { knex } = require('knex')
const config = require('@rm/config')

let _knex = null

function getKojiKnex() {
  if (_knex) return _knex
  const cfg = config.get('kojiDatabase')
  _knex = knex({
    client: 'mysql2',
    connection: {
      host: cfg.host,
      port: cfg.port,
      user: cfg.username,
      password: cfg.password,
      database: cfg.database,
      ssl: cfg.ssl ? {} : false,
    },
    pool: { min: 0, max: 5 },
  })
  return _knex
}

module.exports = { getKojiKnex }
