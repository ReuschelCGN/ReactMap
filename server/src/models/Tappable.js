// @ts-check
const { Model } = require('objection')

class Tappable extends Model {
  static get tableName() {
    return 'tappable'
  }

  static get idColumn() {
    return ['id', 'lat', 'lon']
  }

  /**
   * Returns all tappable records within bounds
   * @param {import('@rm/types').Permissions} perms
   * @param {object} args
   * @returns {Promise<import('@rm/types').Tappable[]>}
   */
  static async getAll(perms, { minLat, maxLat, minLon, maxLon }) {
    // Only show active tappable items (not expired)
    const ts = getEpoch()
    const query = this.query()
      .whereBetween('lat', [minLat, maxLat])
      .whereBetween('lon', [minLon, maxLon])
      .andWhereNotNull('item_id')
      .andWhere('expire_timestamp', '>', ts)

    const results = await query
    return results
  }

  /**
   * Returns the single tappable record after querying it by ID
   * @param {number} id
   */
  static async getOne(id) {
    /** @type {import('@rm/types').Tappable} */
    const result = await this.query().findById(id)
    return result
  }
}

module.exports = { Tappable }
