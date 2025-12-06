// @ts-check
const { getKojiKnex } = require('./kojiDb')
const { log, TAGS } = require('@rm/logger')

/**
 * Cache for property IDs to avoid repeated DB queries
 * @type {Object.<string, number> | null}
 */
let PROPERTY_CACHE = null

/**
 * Get property IDs for ReactMap-specific properties
 * @returns {Promise<Object.<string, number>>}
 */
async function getPropertyIds() {
  if (PROPERTY_CACHE) return PROPERTY_CACHE

  const knex = getKojiKnex()
  const props = await knex('property')
    .where('name', 'like', 'reactmap_%')
    .select('id', 'name')

  PROPERTY_CACHE = {}
  props.forEach((p) => {
    const shortName = p.name.replace('reactmap_', '')
    PROPERTY_CACHE[shortName] = p.id
  })

  log.info(TAGS.db, `Loaded ${props.length} ReactMap properties`)
  return PROPERTY_CACHE
}

/**
 * Set a property value for a fence
 * @param {number} fenceId - Geofence ID
 * @param {string} propertyName - Property name (without reactmap_ prefix)
 * @param {string|number} value - Property value
 * @returns {Promise<void>}
 */
async function setFenceProperty(fenceId, propertyName, value) {
  const knex = getKojiKnex()
  const propIds = await getPropertyIds()
  const propertyId = propIds[propertyName]

  if (!propertyId) {
    throw new Error(`Property '${propertyName}' not found. Did you run the setup SQL script?`)
  }

  const existing = await knex('geofence_property')
    .where({ geofence_id: fenceId, property_id: propertyId })
    .first()

  if (existing) {
    await knex('geofence_property')
      .where({ geofence_id: fenceId, property_id: propertyId })
      .update({ value: String(value) })
  } else {
    await knex('geofence_property').insert({
      geofence_id: fenceId,
      property_id: propertyId,
      value: String(value),
    })
  }
}

/**
 * Get a property value for a fence
 * @param {number} fenceId - Geofence ID
 * @param {string} propertyName - Property name (without reactmap_ prefix)
 * @param {string|null} [defaultValue=null] - Default value if property not found
 * @returns {Promise<string|null>}
 */
async function getFenceProperty(fenceId, propertyName, defaultValue = null) {
  const knex = getKojiKnex()
  const propIds = await getPropertyIds()
  const propertyId = propIds[propertyName]

  if (!propertyId) return defaultValue

  const prop = await knex('geofence_property')
    .where({ geofence_id: fenceId, property_id: propertyId })
    .first()

  return prop ? prop.value : defaultValue
}

/**
 * Get all ReactMap properties for a fence
 * @param {number} fenceId - Geofence ID
 * @returns {Promise<Object.<string, string>>}
 */
async function getAllFenceProperties(fenceId) {
  const knex = getKojiKnex()
  const propIds = await getPropertyIds()

  if (Object.keys(propIds).length === 0) {
    return {}
  }

  const props = await knex('geofence_property')
    .where('geofence_id', fenceId)
    .whereIn('property_id', Object.values(propIds))
    .join('property', 'geofence_property.property_id', 'property.id')
    .select('property.name', 'geofence_property.value')

  const result = {}
  props.forEach((p) => {
    const cleanName = p.name.replace('reactmap_', '')
    result[cleanName] = p.value
  })

  return result
}

/**
 * Delete all ReactMap properties for a fence
 * @param {number} fenceId - Geofence ID
 * @returns {Promise<number>} Number of deleted properties
 */
async function deleteFenceProperties(fenceId) {
  const knex = getKojiKnex()
  const propIds = await getPropertyIds()

  if (Object.keys(propIds).length === 0) {
    return 0
  }

  const deleted = await knex('geofence_property')
    .where('geofence_id', fenceId)
    .whereIn('property_id', Object.values(propIds))
    .delete()

  return deleted
}

/**
 * Clear the property cache (useful after adding new properties)
 */
function clearPropertyCache() {
  PROPERTY_CACHE = null
}

module.exports = {
  getPropertyIds,
  setFenceProperty,
  getFenceProperty,
  getAllFenceProperties,
  deleteFenceProperties,
  clearPropertyCache,
}
