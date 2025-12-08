// @ts-check
const { getKojiKnex } = require('./kojiDb')
const { setFenceProperty, getFenceProperty } = require('./fenceProperties')
const config = require('@rm/config')
const { log, TAGS } = require('@rm/logger')
const { state } = require('./state')

/**
 * Get user's worker statistics
 * @param {string} userId - User identifier
 * @returns {Promise<{total: number, allocated: number, available: number, allocations: Array}>}
 */
async function getUserWorkerStats(userId) {
  const knex = getKojiKnex()

  // Get user-specific limits (if custom settings exist)
  let settings = null
  try {
    if (state?.db?.models?.User) {
      const rmDb = state.db.models.User.knex()
      settings = await rmDb('user_settings').where('user_id', userId).first().catch(() => null)
    }
  } catch (e) {
    // Ignore - use default settings
  }

  const maxWorkers = settings?.max_workers || config.getSafe('fenceSystem.workersPerUser') || 3

  // Get current worker allocations
  const allocations = await knex('fence_workers')
    .where('user_id', userId)
    .join('geofence', 'fence_workers.fence_id', 'geofence.id')
    .select(
      'geofence.id as fenceId',
      'geofence.name as fenceName',
      'fence_workers.worker_count as workers',
    )

  const allocated = allocations.reduce((sum, a) => sum + a.workers, 0)

  // Get owner info for each fence
  const allocationsWithOwner = await Promise.all(
    allocations.map(async (a) => {
      const owner = await getFenceProperty(a.fenceId, 'owner_user_id')
      return {
        fenceId: a.fenceId,
        fenceName: a.fenceName,
        isOwner: owner === userId,
        workers: a.workers,
      }
    }),
  )

  return {
    total: maxWorkers,
    allocated,
    available: maxWorkers - allocated,
    allocations: allocationsWithOwner,
  }
}

/**
 * Assign or remove workers from a fence
 * @param {number} fenceId - Geofence ID
 * @param {string} userId - User identifier
 * @param {number} workerDelta - Number of workers to add (positive) or remove (negative)
 * @returns {Promise<{success: boolean, message?: string}>}
 */
async function adjustFenceWorkers(fenceId, userId, workerDelta) {
  const knex = getKojiKnex()

  return knex.transaction(async (trx) => {
    // 1. Check if fence exists
    const fence = await trx('geofence').where('id', fenceId).first()
    if (!fence) {
      throw new Error('Fence not found')
    }

    // 2. Get user's available workers
    const stats = await getUserWorkerStats(userId)

    // 3. Get current worker assignment for this fence
    const existing = await trx('fence_workers').where({ fence_id: fenceId, user_id: userId }).first()

    const currentWorkers = existing ? existing.worker_count : 0
    const newWorkerCount = currentWorkers + workerDelta

    // 4. Validate the change
    if (workerDelta > 0) {
      // Adding workers - check if user has enough available
      if (stats.available < workerDelta) {
        throw new Error(
          `Not enough available workers. You have ${stats.available} available, but tried to assign ${workerDelta}`,
        )
      }
    }

    if (newWorkerCount < 0) {
      throw new Error('Cannot remove more workers than assigned')
    }

    // 5. Apply the change
    if (newWorkerCount === 0) {
      // Remove worker assignment completely
      if (existing) {
        await trx('fence_workers').where({ fence_id: fenceId, user_id: userId }).delete()
      }
    } else if (existing) {
      // Update existing assignment
      await trx('fence_workers')
        .where({ fence_id: fenceId, user_id: userId })
        .update({
          worker_count: newWorkerCount,
          updated_at: trx.fn.now(),
        })
    } else {
      // Create new assignment
      await trx('fence_workers').insert({
        fence_id: fenceId,
        user_id: userId,
        worker_count: newWorkerCount,
      })
    }

    // 6. Update fence total workers and last activity
    const totalResult = await trx('fence_workers')
      .where('fence_id', fenceId)
      .sum('worker_count as total')
      .first()

    const totalWorkers = totalResult?.total || 0

    await setFenceProperty(fenceId, 'total_workers', totalWorkers)
    await setFenceProperty(fenceId, 'last_worker_activity', new Date().toISOString())

    // 7. Recalculate ownership
    await recalculateFenceOwnership(fenceId, trx)

    // 8. Sync with Dragonite
    let dragoniteAreaId = await getFenceProperty(fenceId, 'dragonite_area_id')
    let createdNewArea = false
    if (!dragoniteAreaId && totalWorkers > 0) {
      // Create Dragonite area on first worker assignment if missing
      try {
        const knex2 = getKojiKnex()
        const fenceRow = await knex2('geofence').where('id', fenceId).first()
        if (fenceRow) {
          const ownerUserId = await getFenceProperty(fenceId, 'owner_user_id')
          // Get original fence name directly from geofence table
          const originalName = fenceRow.name || 'fence'
          let geometryObj
          try {
            geometryObj = typeof fenceRow.geometry === 'string' ? JSON.parse(fenceRow.geometry) : fenceRow.geometry
          } catch (_) {
            geometryObj = fenceRow.geometry
          }
          // Create area in Dragonite
          /** @type {any} */
          const dg = config.getSafe('integrations.dragonite') || {}
          const baseUrl = dg.baseUrl
          if (baseUrl && geometryObj?.type && geometryObj?.coordinates) {
            /** @type {Record<string,string>} */
            const headers = { 'Content-Type': 'application/json' }
            if (dg.instance) headers['x-backend-instance'] = String(dg.instance)
            if (dg.authHeaderName && dg.authHeaderValue) headers[dg.authHeaderName] = dg.authHeaderValue

            const coords = geometryObj.type === 'Polygon'
              ? geometryObj.coordinates[0]
              : (geometryObj.type === 'MultiPolygon' ? geometryObj.coordinates[0][0] : null)
            const geofence = Array.isArray(coords) ? coords.map(([lng, lat]) => ({ lat, lon: lng })) : []

            const finalName = `${ownerUserId || userId}_${originalName}`
            const defaults = dg.defaults || {}
            const payload = {
              name: finalName,
              enabled: totalWorkers > 0,
              geofence,
              enable_quests: defaults?.enable_quests ?? true,
              pokemon_mode: defaults?.pokemon_mode || { workers: Math.max(totalWorkers, 0), enable_scout: false, invasion: false },
              quest_mode: defaults?.quest_mode || { hours: [1, 10] },
            }
            const resp = await fetch(`${baseUrl}/areas/`, { method: 'POST', headers, body: JSON.stringify(payload) })
            if (resp.ok) {
              const data = await resp.json().catch(() => ({}))
              const newId = data?.id || data?.data?.id
              if (newId) {
                dragoniteAreaId = String(newId)
                await setFenceProperty(fenceId, 'dragonite_area_id', dragoniteAreaId)
                log.info(TAGS.api, `Created Dragonite area ${dragoniteAreaId} for fence ${fenceId} on worker assign`)
                createdNewArea = true

                // Wait 3s, then trigger Dragonite full reload
                try {
                  await new Promise((r) => setTimeout(r, 3000))
                  const reloadUrl = `${baseUrl}/reload`
                  const reloadResp = await fetch(reloadUrl, { method: 'GET', headers })
                  if (reloadResp.ok) {
                    log.info(TAGS.api, `Triggered Dragonite reload after create (area ${newId})`)
                  } else {
                    const t = await reloadResp.text().catch(() => '')
                    log.warn(TAGS.api, `Dragonite reload after create failed: ${reloadResp.status} ${t}`)
                  }
                } catch (reloadErr) {
                  log.warn(TAGS.api, `Dragonite reload after create exception:`, reloadErr?.message || reloadErr)
                }

                // Wait another 2s, then trigger bootstrap to start scanning
                try {
                  await new Promise((r) => setTimeout(r, 2000))
                  const bootstrapUrl = `${baseUrl}/recalculate/${newId}/pokemon?bootstrap=true`
                  const bootstrapResp = await fetch(bootstrapUrl, { method: 'GET', headers })
                  if (bootstrapResp.ok) {
                    log.info(TAGS.api, `Triggered bootstrap for new Dragonite area ${newId}`)
                  } else {
                    const t = await bootstrapResp.text().catch(() => '')
                    log.warn(TAGS.api, `Bootstrap failed for area ${newId}: ${bootstrapResp.status} ${t}`)
                  }
                } catch (bootstrapErr) {
                  log.warn(TAGS.api, `Bootstrap exception for area ${newId}:`, bootstrapErr?.message || bootstrapErr)
                }
              }
            } else {
              const text = await resp.text().catch(() => '')
              log.warn(TAGS.api, `Failed creating Dragonite area for fence ${fenceId}: ${resp.status} ${text}`)
            }
          }
        }
      } catch (e) {
        log.warn(TAGS.api, `adjustFenceWorkers: create Dragonite area failed for fence ${fenceId}`, e?.message || e)
      }
    }
    if (dragoniteAreaId && !createdNewArea) {
      await syncDragoniteWorkers(parseInt(dragoniteAreaId, 10), totalWorkers)
    }

    return {
      success: true,
      totalWorkers,
      userWorkers: newWorkerCount,
    }
  })
}

/**
 * Recalculate fence ownership based on worker distribution
 * @param {number} fenceId - Geofence ID
 * @param {import('knex').Knex.Transaction} [trx] - Optional transaction
 * @returns {Promise<string|null>} New owner user ID or null
 */
async function recalculateFenceOwnership(fenceId, trx = null) {
  const knex = trx || getKojiKnex()

  const workers = await knex('fence_workers').where('fence_id', fenceId).select('user_id', 'worker_count')

  if (workers.length === 0) {
    // No workers - keep current owner but mark as inactive
    await setFenceProperty(fenceId, 'total_workers', 0)
    await setFenceProperty(fenceId, 'last_worker_activity', new Date().toISOString())
    return null
  }

  // Find user with most workers
  const topContributor = workers.reduce((max, w) => (w.worker_count > max.worker_count ? w : max))

  const totalWorkers = workers.reduce((sum, w) => sum + w.worker_count, 0)

  // Update owner
  const currentOwner = await getFenceProperty(fenceId, 'owner_user_id')
  if (currentOwner !== topContributor.user_id) {
    await setFenceProperty(fenceId, 'owner_user_id', topContributor.user_id)
    // Try to store a human-readable owner display name as well
    try {
      let ownerName = String(topContributor.user_id)
      if (state?.db?.models?.User) {
        let user = null
        if (/^\d+$/.test(String(topContributor.user_id))) {
          user = await state.db.models.User.query()
            .where('discordId', topContributor.user_id)
            .orWhere('telegramId', topContributor.user_id)
            .first()
            .catch(() => null)
        }
        if (!user) {
          user = await state.db.models.User.query()
            .where('username', topContributor.user_id)
            .first()
            .catch(() => null)
        }
        if (user && user.username) {
          ownerName = user.username
        }
      }
      await setFenceProperty(fenceId, 'owner_display_name', ownerName)
    } catch (_) {
      // ignore display name failure
    }
    
    // Update geofence_project links - add new owner's project, keep reactmap/poracle/selfmap
    const newUserId = topContributor.user_id
    
    // Ensure new owner's project exists
    let newUserProject = await knex('project').select('id').where('name', newUserId).first()
    if (!newUserProject) {
      await knex('project').insert({ name: newUserId })
      newUserProject = await knex('project').select('id').where('name', newUserId).first()
    }
    
    // Remove old owner's project link (but keep reactmap/poracle/selfmap)
    if (currentOwner) {
      const oldUserProject = await knex('project').select('id').where('name', currentOwner).first()
      if (oldUserProject) {
        await knex('geofence_project')
          .where({ geofence_id: fenceId, project_id: oldUserProject.id })
          .delete()
      }
    }
    
    // Add new owner's project link
    const existingLink = await knex('geofence_project')
      .where({ geofence_id: fenceId, project_id: newUserProject.id })
      .first()
    
    if (!existingLink) {
      await knex('geofence_project').insert({
        geofence_id: fenceId,
        project_id: newUserProject.id,
      })
    }
    
    // Recreate Dragonite area with new owner's user ID in the name
    try {
      const oldDragoniteAreaId = await getFenceProperty(fenceId, 'dragonite_area_id')
      if (oldDragoniteAreaId) {
        // Delete old Dragonite area
        const dg = config.getSafe('integrations.dragonite') || {}
        const baseUrl = dg.baseUrl
        if (baseUrl) {
          const headers = {}
          if (dg.instance) headers['x-backend-instance'] = String(dg.instance)
          if (dg.authHeaderName && dg.authHeaderValue) {
            headers[String(dg.authHeaderName)] = String(dg.authHeaderValue)
          }
          
          try {
            const delUrl = `${baseUrl}/areas/${encodeURIComponent(String(oldDragoniteAreaId))}`
            const delResp = await fetch(delUrl, { method: 'DELETE', headers })
            if (delResp.ok) {
              log.info(TAGS.api, `Deleted old Dragonite area ${oldDragoniteAreaId} for ownership transfer`)
            }
          } catch (e) {
            log.warn(TAGS.api, `Failed to delete Dragonite area ${oldDragoniteAreaId}:`, e.message)
          }
        }
        
        // Clear the dragonite_area_id property - will be recreated on next area reload
        await setFenceProperty(fenceId, 'dragonite_area_id', '')
        
        // Trigger area reload to recreate Dragonite area from Koji data with new owner
        const { loadLatestAreas } = require('../services/areas')
        await loadLatestAreas()
        log.info(TAGS.api, `Triggered area reload to recreate Dragonite area for fence ${fenceId}`)
      }
    } catch (dragoniteErr) {
      log.error(TAGS.api, `Failed to recreate Dragonite area during ownership transfer:`, dragoniteErr)
      // Don't fail the ownership transfer if Dragonite fails
    }
    
    log.info(
      TAGS.api,
      `Fence ${fenceId} ownership transferred from ${currentOwner} to ${topContributor.user_id}`,
    )
  }

  await setFenceProperty(fenceId, 'total_workers', totalWorkers)

  return topContributor.user_id
}

/**
 * Sync worker count with Dragonite
 * @param {number} dragoniteAreaId - Dragonite area ID
 * @param {number} totalWorkers - Total worker count
 * @returns {Promise<void>}
 */
async function syncDragoniteWorkers(dragoniteAreaId, totalWorkers) {
  try {
    /** @type {any} */
    const dg = config.getSafe('integrations.dragonite') || {}
    const baseUrl = dg.baseUrl

    if (!baseUrl) {
      log.warn(TAGS.api, 'Dragonite baseUrl not configured, skipping worker sync')
      return
    }

    /** @type {Record<string,string>} */
    const headers = { 'Content-Type': 'application/json' }
    if (dg.instance) headers['x-backend-instance'] = String(dg.instance)
    if (dg.authHeaderName && dg.authHeaderValue) {
      headers[dg.authHeaderName] = dg.authHeaderValue
    }

    const resp = await fetch(`${baseUrl}/areas/${dragoniteAreaId}`, {
      method: 'PATCH',
      headers,
      body: JSON.stringify({
        enabled: totalWorkers > 0,
        pokemon_mode: {
          workers: Math.max(totalWorkers, 0),
          enable_scout: false,
          invasion: false,
        },
      }),
    })

    if (!resp.ok) {
      const text = await resp.text().catch(() => '')
      throw new Error(`Dragonite sync failed: ${resp.status} ${text}`)
    }

    log.info(TAGS.api, `Synced ${totalWorkers} workers to Dragonite area ${dragoniteAreaId}`)
  } catch (e) {
    log.error(TAGS.api, 'syncDragoniteWorkers failed', e)
    // Don't throw - worker assignment should succeed even if Dragonite sync fails
  }
}

/**
 * Get all contributors for a fence
 * @param {number} fenceId - Geofence ID
 * @returns {Promise<Array<{userId: string, userName: string, workers: number, isOwner: boolean}>>}
 */
async function getFenceContributors(fenceId) {
  const knex = getKojiKnex()

  const contributors = await knex('fence_workers')
    .where('fence_id', fenceId)
    .select('user_id', 'worker_count')
    .orderBy('worker_count', 'desc')

  const owner = await getFenceProperty(fenceId, 'owner_user_id')

  // Resolve user names from ReactMap database
  const contributorsWithNames = await Promise.all(
    contributors.map(async (c) => {
      let userName = c.user_id // Fallback to ID
      
      try {
        if (state?.db?.models?.User) {
          // Try to find user by discordId, telegramId, or username
          let user = null
          
          // Check if it's a numeric ID (Discord/Telegram)
          if (/^\d+$/.test(c.user_id)) {
            user = await state.db.models.User.query()
              .where('discordId', c.user_id)
              .orWhere('telegramId', c.user_id)
              .first()
              .catch(() => null)
          }
          
          // If not found, try username
          if (!user) {
            user = await state.db.models.User.query()
              .where('username', c.user_id)
              .first()
              .catch(() => null)
          }
          
          // Use the most readable identifier
          if (user) {
            userName = user.username || user.discordId || user.telegramId || c.user_id
          }
        }
      } catch (e) {
        log.warn(TAGS.api, 'Failed to resolve user name for', c.user_id, e.message)
      }
      
      return {
        userId: c.user_id,
        userName,
        workers: c.worker_count,
        isOwner: c.user_id === owner,
      }
    })
  )

  return contributorsWithNames
}

/**
 * Get user's fence count
 * @param {string} userId - User identifier
 * @returns {Promise<number>}
 */
async function getUserFenceCount(userId) {
  const knex = getKojiKnex()
  const propIds = await require('./fenceProperties').getPropertyIds()
  const ownerPropId = propIds.owner_user_id

  if (!ownerPropId) return 0

  const result = await knex('geofence_property')
    .where('property_id', ownerPropId)
    .where('value', userId)
    .count('* as count')
    .first()

  return result?.count || 0
}

module.exports = {
  getUserWorkerStats,
  adjustFenceWorkers,
  recalculateFenceOwnership,
  syncDragoniteWorkers,
  getFenceContributors,
  getUserFenceCount,
}
