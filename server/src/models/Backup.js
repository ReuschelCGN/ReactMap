/* eslint-disable no-bitwise */
const { Model } = require('objection')
const {
  database: {
    settings: {
      userBackupLimits,
      userBackupSizeLimit,
      userTableName,
      backupTableName,
    },
  },
} = require('../services/config')

const bytes = (s) => ~-encodeURI(s).split(/%..|./).length

const jsonSize = (s) => bytes(JSON.stringify(s))

module.exports = class Backup extends Model {
  static get tableName() {
    return backupTableName
  }

  $beforeInsert() {
    this.createdAt = Math.floor(Date.now() / 1000)
    this.updatedAt = Math.floor(Date.now() / 1000)
  }

  $beforeUpdate() {
    this.updatedAt = Math.floor(Date.now() / 1000)
  }

  static get relationMappings() {
    // eslint-disable-next-line global-require
    const User = require('./User')
    return {
      user: {
        relation: Model.BelongsToOneRelation,
        modelClass: User,
        join: {
          from: `${backupTableName}.userId`,
          to: `${userTableName}.id`,
        },
      },
    }
  }

  static async getOne(id, userId) {
    return this.query().findById(id).where('userId', userId)
  }

  static async getAll(userId) {
    return this.query()
      .select(['id', 'name', 'createdAt', 'updatedAt'])
      .where('userId', userId)
      .whereNotNull('data')
  }

  static async create({ name, data }, userId) {
    if (jsonSize(data) > userBackupSizeLimit) throw new Error('Data too large')
    const count = await this.query().count().where('userId', userId).first()
    if (count['count(*)'] < userBackupLimits) {
      return this.query().insert({ userId, name, data: JSON.stringify(data) })
    }
  }

  static async update({ id, name, data }, userId) {
    if (jsonSize(data) > userBackupSizeLimit) throw new Error('Data too large')
    return this.query()
      .update({ name, data: JSON.stringify(data) })
      .where('id', +id)
      .where('userId', userId)
  }

  static async delete(id, userId) {
    return this.query().deleteById(id).where('userId', userId)
  }
}
