/* eslint-disable no-restricted-syntax */
/* eslint-disable no-await-in-loop */
// @ts-check
const router = require('express').Router()
const { log, TAGS } = require('@rm/logger')
const { state } = require('../../../services/state')
const { getKojiKnex } = require('../../../services/kojiDb')
const config = require('@rm/config')
const { loadLatestAreas } = require('../../../services/areas')
const { requireAuth } = require('../../../middleware/requireAuth')
const { requirePerm } = require('../../../middleware/requirePerm')
const { getUserWorkerStats, adjustFenceWorkers, getFenceContributors } = require('../../../services/workerManager')
const { setFenceProperty, getFenceProperty } = require('../../../services/fenceProperties')

// Helper: Lösche eine einzelne Dragonite Area by ID
async function deleteDragoniteArea(areaId) {
  const dg = config.getSafe('integrations.dragonite') || {}
  const baseUrl = dg.baseUrl
  if (!baseUrl) {
    log.warn(TAGS.api, 'deleteDragoniteArea: baseUrl missing')
    return { success: false, error: 'baseUrl missing' }
  }

  const headers = {}
  if (dg.instance) headers['x-backend-instance'] = String(dg.instance)
  if (dg.authHeaderName && dg.authHeaderValue) {
    headers[String(dg.authHeaderName)] = String(dg.authHeaderValue)
  }

  try {
    const delUrl = `${baseUrl}/areas/${encodeURIComponent(String(areaId))}`
    const delResp = await fetch(delUrl, { method: 'DELETE', headers })
    if (delResp.ok) {
      log.info(TAGS.api, `Deleted Dragonite area ${areaId}`)
      return { success: true }
    }
    const body = await delResp.text().catch(() => '')
    return { success: false, error: `Delete failed: ${delResp.status} ${body}` }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

// Helper: Robuste Dragonite Area Löschung mit mehrfachen Versuchen
async function deleteAllDragoniteAreasForUser(userKey, maxPasses = 10) {
  const dg = config.getSafe('integrations.dragonite') || {}
  const baseUrl = dg.baseUrl
  if (!baseUrl) {
    log.warn(TAGS.api, 'deleteAllDragoniteAreasForUser: baseUrl missing')
    return { deleted: 0, errors: [] }
  }

  const headers = {}
  if (dg.instance) headers['x-backend-instance'] = String(dg.instance)
  if (dg.authHeaderName && dg.authHeaderValue) {
    headers[String(dg.authHeaderName)] = String(dg.authHeaderValue)
  }

  const prefix = `${userKey}_`
  let totalDeleted = 0
  const errors = []

  // Mehrfache Durchläufe um sicherzustellen dass alles gelöscht wird
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let page = 0
    let foundOnThisPass = 0

    for (let pageSafety = 0; pageSafety < 200; pageSafety += 1) {
      try {
        const url = `${baseUrl}/areas/?order=ASC&page=${page}&perPage=1000&sortBy=name`
        const resp = await fetch(url, { method: 'GET', headers })
        if (!resp.ok) {
          if (pass === 0 && page === 0) {
            errors.push(`List failed: ${resp.status}`)
          }
          break
        }

        let payload
        try {
          payload = await resp.json()
        } catch {
          payload = []
        }

        const rows = Array.isArray(payload)
          ? payload
          : (Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload?.data) ? payload.data : []))
        const hasNext = Boolean(payload?.pagination?.hasNext)

        const mine = (rows || []).filter((a) => String(a?.name || '').startsWith(prefix))
        foundOnThisPass += mine.length

        for (const a of mine) {
          try {
            const delUrl = `${baseUrl}/areas/${encodeURIComponent(String(a.id))}`
            const delResp = await fetch(delUrl, { method: 'DELETE', headers })
            if (delResp.ok) {
              totalDeleted += 1
              log.info(TAGS.api, `Deleted Dragonite area ${a.id} (${a.name})`)
            } else {
              const body = await delResp.text().catch(() => '')
              errors.push(`Delete ${a.id} failed: ${delResp.status} ${body}`)
            }
          } catch (e) {
            errors.push(`Delete ${a.id} exception: ${e.message}`)
          }
        }

        if (!hasNext) break
        page += 1
      } catch (e) {
        errors.push(`Page ${page} exception: ${e.message}`)
        break
      }
    }

    if (foundOnThisPass === 0) break
  }

  return { deleted: totalDeleted, errors }
}

// Helper: Erstelle Dragonite Area mit Retry (mit eindeutigem Namen pro Fence)
async function createDragoniteAreaForUser(userKey, name, geometry, maxRetries = 3) {
  const dg = config.getSafe('integrations.dragonite') || {}
  const baseUrl = dg.baseUrl
  if (!baseUrl) throw new Error('Dragonite baseUrl missing')

  const headers = { 'Content-Type': 'application/json' }
  if (dg.instance) headers['x-backend-instance'] = String(dg.instance)
  if (dg.authHeaderName && dg.authHeaderValue) {
    headers[String(dg.authHeaderName)] = String(dg.authHeaderValue)
  }

  const defaults = dg.defaults || {}
  // Eindeutiger Name: userKey_timestamp_name
  const timestamp = Date.now()
  const finalName = `${userKey}_${timestamp}_${name}`

  // Convert GeoJSON to Dragonite format
  const coords = geometry?.type === 'Polygon'
    ? geometry.coordinates[0]
    : (geometry?.type === 'MultiPolygon' ? geometry.coordinates[0][0] : null)
  
  if (!Array.isArray(coords)) throw new Error('Invalid geometry for Dragonite')
  
  const geofence = coords.map(([lng, lat]) => ({ lat, lon: lng }))

  const payload = {
    name: finalName,
    enabled: true,
    geofence,
    enable_quests: defaults?.enable_quests ?? true,
    pokemon_mode: defaults?.pokemon_mode || { workers: 1, enable_scout: false, invasion: false },
    quest_mode: defaults?.quest_mode || { hours: [1, 10] },
  }

  let lastError
  for (let attempt = 0; attempt < maxRetries; attempt += 1) {
    try {
      const resp = await fetch(`${baseUrl}/areas/`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      })

      if (!resp.ok) {
        const text = await resp.text().catch(() => '')
        throw new Error(`Dragonite POST failed: ${resp.status} ${text}`)
      }

      const data = await resp.json().catch(() => ({}))
      const areaId = data?.id || data?.data?.id
      if (!areaId) throw new Error('No area ID in Dragonite response')

      log.info(TAGS.api, `Created Dragonite area ${areaId} (${finalName})`)
      return areaId
    } catch (e) {
      lastError = e
      if (attempt < maxRetries - 1) {
        const delay = 1000 * (attempt + 1)
        log.warn(TAGS.api, `Dragonite create attempt ${attempt + 1} failed, retrying in ${delay}ms`, e.message)
        await new Promise((resolve) => setTimeout(resolve, delay))
      }
    }
  }

  throw lastError || new Error('Dragonite create failed after retries')
}

// Helper: Update Dragonite Area (versucht PUT, falls nicht möglich DELETE+POST)
async function updateDragoniteAreaForUser(userKey, name, geometry, existingAreaId = null) {
  const dg = config.getSafe('integrations.dragonite') || {}
  const baseUrl = dg.baseUrl
  if (!baseUrl) throw new Error('Dragonite baseUrl missing')

  const headers = { 'Content-Type': 'application/json' }
  if (dg.instance) headers['x-backend-instance'] = String(dg.instance)
  if (dg.authHeaderName && dg.authHeaderValue) {
    headers[String(dg.authHeaderName)] = String(dg.authHeaderValue)
  }

  const defaults = dg.defaults || {}
  // Eindeutiger Name: userKey_timestamp_name (für Update)
  const timestamp = Date.now()
  const finalName = `${userKey}_${timestamp}_${name}`

  // Convert GeoJSON to Dragonite format
  const coords = geometry?.type === 'Polygon'
    ? geometry.coordinates[0]
    : (geometry?.type === 'MultiPolygon' ? geometry.coordinates[0][0] : null)
  
  if (!Array.isArray(coords)) throw new Error('Invalid geometry for Dragonite')
  
  const geofence = coords.map(([lng, lat]) => ({ lat, lon: lng }))

  // Step 1: Finde existierende Area (nur wenn nicht übergeben)
  if (!existingAreaId) {
    try {
      const listUrl = `${baseUrl}/areas/?q=${encodeURIComponent(userKey)}_`
      const listResp = await fetch(listUrl, { method: 'GET', headers: { ...headers, 'Content-Type': undefined } })
      if (listResp.ok) {
        const areas = await listResp.json().catch(() => [])
        const userAreas = Array.isArray(areas) ? areas : (areas?.items || areas?.data || [])
        if (userAreas.length > 0) {
          existingAreaId = userAreas[0].id
          log.info(TAGS.api, `Found existing Dragonite area ${existingAreaId} for user ${userKey} (via search)`)
        }
      }
    } catch (e) {
      log.warn(TAGS.api, 'Failed to find existing Dragonite area', e.message)
    }
  } else {
    log.info(TAGS.api, `Using provided Dragonite area ID ${existingAreaId} for user ${userKey}`)
  }

  // Step 2: Versuche PUT/PATCH zum Updaten
  if (existingAreaId) {
    const updatePayload = {
      name: finalName,
      enabled: true,
      geofence,
      enable_quests: defaults?.enable_quests ?? true,
      pokemon_mode: defaults?.pokemon_mode || { workers: 1, enable_scout: false, invasion: false },
      quest_mode: defaults?.quest_mode || { hours: [1, 10] },
    }

    // Versuche PUT
    try {
      const putResp = await fetch(`${baseUrl}/areas/${encodeURIComponent(existingAreaId)}`, {
        method: 'PUT',
        headers,
        body: JSON.stringify(updatePayload),
      })

      if (putResp.ok) {
        log.info(TAGS.api, `Updated Dragonite area ${existingAreaId} via PUT for user ${userKey}`)
        return existingAreaId
      }
      
      log.warn(TAGS.api, `PUT failed (${putResp.status}), trying PATCH...`)
    } catch (e) {
      log.warn(TAGS.api, 'PUT request failed', e.message)
    }

    // Versuche PATCH (nur geofence updaten)
    try {
      const patchPayload = {
        geofence,
        enabled: true,
        enable_quests: defaults?.enable_quests ?? true,
      }
      
      const patchResp = await fetch(`${baseUrl}/areas/${encodeURIComponent(existingAreaId)}`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify(patchPayload),
      })

      if (patchResp.ok) {
        log.info(TAGS.api, `Updated Dragonite area ${existingAreaId} via PATCH for user ${userKey}`)
        return existingAreaId
      }
      
      const patchText = await patchResp.text().catch(() => '')
      log.warn(TAGS.api, `PATCH failed (${patchResp.status}): ${patchText}, falling back to DELETE+POST...`)
    } catch (e) {
      log.warn(TAGS.api, 'PATCH request failed', e.message)
    }
  }

  // Step 3: Fallback - DELETE alte + POST neue
  log.info(TAGS.api, `Falling back to DELETE+POST for user ${userKey}`)
  const delResult = await deleteAllDragoniteAreasForUser(userKey)
  log.info(TAGS.api, `Deleted ${delResult.deleted} Dragonite areas for user ${userKey}`)
  
  const newId = await createDragoniteAreaForUser(userKey, name, geometry)
  log.info(TAGS.api, `Created new Dragonite area ${newId} for user ${userKey}`)
  return newId
}

// Helper: Recalculate Dragonite Area
async function recalculateDragoniteArea(areaId) {
  const dg = config.getSafe('integrations.dragonite') || {}
  const baseUrl = dg.baseUrl
  if (!baseUrl) {
    log.warn(TAGS.api, 'recalculateDragoniteArea: baseUrl missing')
    return false
  }

  const headers = {}
  if (dg.instance) headers['x-backend-instance'] = String(dg.instance)
  if (dg.authHeaderName && dg.authHeaderValue) {
    headers[String(dg.authHeaderName)] = String(dg.authHeaderValue)
  }

  try {
    const url = `${baseUrl}/recalculate/${encodeURIComponent(areaId)}/pokemon?bootstrap=false`
    const resp = await fetch(url, { method: 'GET', headers })
    if (resp.ok) {
      log.info(TAGS.api, `Recalculated Dragonite area ${areaId}`)
      return true
    }
    const text = await resp.text().catch(() => '')
    log.warn(TAGS.api, `Recalculate ${areaId} failed: ${resp.status} ${text}`)
    return false
  } catch (e) {
    log.warn(TAGS.api, `Recalculate ${areaId} exception:`, e.message)
    return false
  }
}

router.get('/', async (req, res) => {
  try {
    res.status(200).json(await state.db.models.User.query())
    log.info(TAGS.api, 'api/v1/users')
  } catch (e) {
    log.error(TAGS.api, 'api/v1/sessions', e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// PUT /api/v1/users/geofence/:fenceId -> update existing fence by ID in BOTH Koji and Dragonite
router.put('/geofence/:fenceId', requireAuth, requirePerm('fenceEditor'), async (req, res) => {
  const { fenceId } = req.params
  const trxDb = getKojiKnex()
  const { geometry, name, mode } = req.body || {}
  try {
    if (!fenceId) return res.status(400).json({ status: 'error', reason: 'Missing fence ID' })
    if (!geometry) return res.status(400).json({ status: 'error', reason: 'Missing geometry' })

    let userIdStr = `${
      req?.user?.discordId || req?.user?.telegramId || req?.user?.username || req?.user?.id || ''
    }`
    if (!userIdStr) {
      try {
        const fullUser = req?.user?.id ? await state.db.models.User.query().findById(req.user.id) : null
        userIdStr = `${
          fullUser?.discordId || fullUser?.telegramId || fullUser?.username || fullUser?.id || ''
        }`
      } catch (_) {}
    }
    if (!userIdStr) {
      return res.status(400).json({ status: 'error', reason: 'No logged-in user' })
    }

    // Normalize geometry
    let geometryJson
    let geometryObj
    if (typeof geometry === 'string') {
      try {
        const parsed = JSON.parse(geometry)
        geometryObj = parsed && parsed.type && parsed.coordinates
          ? { coordinates: parsed.coordinates, type: parsed.type }
          : parsed
        geometryJson = JSON.stringify(geometryObj)
      } catch {
        geometryJson = geometry
        geometryObj = JSON.parse(geometry)
      }
    } else {
      geometryObj = geometry && geometry.type && geometry.coordinates
        ? { coordinates: geometry.coordinates, type: geometry.type }
        : geometry
      geometryJson = JSON.stringify(geometryObj)
    }

    // Step 1: Verify fence exists and user owns it
    const fence = await trxDb('geofence').where('id', fenceId).first()
    if (!fence) {
      return res.status(404).json({ status: 'error', reason: 'Fence not found' })
    }

    // Check ownership
    const owner = await getFenceProperty(parseInt(fenceId, 10), 'owner_user_id')
    if (owner !== userIdStr) {
      return res.status(403).json({ status: 'error', reason: 'You do not own this fence' })
    }

    // Step 2: Update Koji fence
    let kojiId = parseInt(fenceId, 10)
    let fenceName = name || fence.name || 'fence'
    await trxDb.transaction(async (knex) => {
      const payload = {
        geometry: geometryJson,
        updated_at: knex.fn.now(),
      }
      if (name) {
        payload.name = name
        fenceName = name
        
        // Update geofence_property with leading underscore for Poracle filtering
        try {
          let prop = await knex('property').select('id').where('name', 'name').first().catch(() => null)
          const propertyId = (prop && prop.id) ? prop.id : 21
          const nameWithUnderscore = `_${name}`
          
          // Check if property exists
          const existingProp = await knex('geofence_property')
            .where({ geofence_id: kojiId, property_id: propertyId })
            .first()
          
          if (existingProp) {
            await knex('geofence_property')
              .where({ geofence_id: kojiId, property_id: propertyId })
              .update({ value: nameWithUnderscore })
          } else {
            await knex('geofence_property').insert({
              geofence_id: kojiId,
              property_id: propertyId,
              value: nameWithUnderscore,
            })
          }
        } catch (propErr) {
          log.warn(TAGS.api, 'users/geofence update geofence_property failed', propErr?.message || propErr)
        }
      }
      if (mode && ['auto_quest', 'auto_pokemon', 'auto_tth', 'pokemon_iv', 'unset'].includes(mode)) {
        payload.mode = mode
      }
      await knex('geofence').where('id', fenceId).update(payload)
      log.info(TAGS.api, `Updated Koji fence ${kojiId} for user ${userIdStr}`)
    })

    // Step 3: Update in Dragonite (get area ID from fence properties)
    let dragoniteId
    let dragoniteError
    try {
      // Get existing Dragonite area ID from fence properties
      const existingDragoniteId = await getFenceProperty(kojiId, 'dragonite_area_id')
      dragoniteId = await updateDragoniteAreaForUser(userIdStr, fenceName, geometryObj, existingDragoniteId)
      log.info(TAGS.api, `Updated Dragonite area ${dragoniteId} for user ${userIdStr} (PUT)`)
      
      // Update stored Dragonite area ID if it changed
      if (dragoniteId && dragoniteId !== existingDragoniteId) {
        await setFenceProperty(kojiId, 'dragonite_area_id', dragoniteId)
      }

      // Trigger recalculation
      await recalculateDragoniteArea(dragoniteId)
    } catch (drErr) {
      dragoniteError = drErr.message
      log.error(TAGS.api, 'Dragonite fence update failed:', drErr)
    }

    // Reload ReactMap areas
    try {
      const newAreas = await loadLatestAreas()
      config.setAreas(newAreas)
    } catch (e) {
      log.warn(TAGS.api, 'Area reload failed', e?.message || e)
    }

    // Return result
    if (dragoniteError) {
      return res.status(207).json({
        status: 'partial',
        kojiId,
        dragoniteId: null,
        error: `Koji OK, Dragonite failed: ${dragoniteError}`,
        message: 'Fence in Koji aktualisiert, aber Dragonite-Synchronisation fehlgeschlagen.',
      })
    }

    res.status(200).json({ status: 'ok', kojiId, dragoniteId })
    log.info(TAGS.api, 'api/v1/users/geofence [PUT] success')
  } catch (e) {
    log.error(TAGS.api, 'api/v1/users/geofence [PUT]', e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// DELETE /api/v1/users/geofence -> purge all fences for current user in Koji and Dragonite
router.delete('/geofence', requireAuth, async (req, res) => {
  try {
    // resolve user key
    let userIdStr = `${
      req?.user?.discordId || req?.user?.telegramId || req?.user?.username || req?.user?.id || ''
    }`
    if (!userIdStr) {
      try {
        const fullUser = req?.user?.id ? await state.db.models.User.query().findById(req.user.id) : null
        userIdStr = `${
          fullUser?.discordId || fullUser?.telegramId || fullUser?.username || fullUser?.id || ''
        }`
      } catch (_) {}
    }
    if (!userIdStr) {
      return res.status(400).json({ status: 'error', reason: 'Cannot resolve user id' })
    }

    // Step 1: Koji cleanup
    let kojiDeleted = 0
    try {
      const db = getKojiKnex()
      await db.transaction(async (knex) => {
        // Find user project
        let userProject = await knex('project').select('id').where('name', userIdStr).first()
        if (!userProject && req?.user?.id) {
          userProject = await knex('project').select('id').where('name', String(req.user.id)).first()
        }
        
        if (userProject) {
          // Find all geofences linked to user project
          const links = await knex('geofence_project')
            .select('geofence_id')
            .where('project_id', userProject.id)
          const ids = Array.isArray(links) ? links.map((l) => l.geofence_id).filter(Boolean) : []
          
          if (ids.length) {
            // Delete links
            await knex('geofence_project').whereIn('geofence_id', ids).del()
            // Delete properties
            try { await knex('geofence_property').whereIn('geofence_id', ids).del() } catch (_) {}
            // Delete geofences
            kojiDeleted = await knex('geofence').whereIn('id', ids).del()
            log.info(TAGS.api, `Deleted ${kojiDeleted} Koji fences for user ${userIdStr}`)
          }
        }
      })
    } catch (e) {
      log.error(TAGS.api, 'users/geofence [DELETE] Koji cleanup failed', e?.message || e)
      return res.status(500).json({ status: 'error', reason: `Koji delete failed: ${e.message}` })
    }

    // Step 2: Dragonite cleanup (robust multi-pass)
    let dragoniteDeleted = 0
    let dragoniteError
    try {
      const delResult = await deleteAllDragoniteAreasForUser(userIdStr)
      dragoniteDeleted = delResult.deleted
      log.info(TAGS.api, `Deleted ${dragoniteDeleted} Dragonite areas for user ${userIdStr}`)
      if (delResult.errors.length > 0) {
        log.warn(TAGS.api, 'Dragonite delete had errors:', delResult.errors.slice(0, 5))
        dragoniteError = delResult.errors.join(', ')
      }
    } catch (e) {
      dragoniteError = e.message
      log.error(TAGS.api, 'users/geofence [DELETE] Dragonite cleanup failed', e)
    }

    // Reload areas
    try {
      const newAreas = await loadLatestAreas()
      config.setAreas(newAreas)
    } catch (e) {
      log.warn(TAGS.api, 'users/geofence [DELETE] reload failed', e?.message || e)
    }

    // Return result
    if (dragoniteError && dragoniteDeleted === 0) {
      return res.status(207).json({
        status: 'partial',
        kojiDeleted,
        dragoniteDeleted: 0,
        error: `Koji OK, Dragonite failed: ${dragoniteError}`,
        message: 'Fences in Koji gelöscht, aber Dragonite-Synchronisation fehlgeschlagen.',
      })
    }

    res.status(200).json({ status: 'ok', kojiDeleted, dragoniteDeleted })
    log.info(TAGS.api, 'users/geofence [DELETE] success')
  } catch (e) {
    log.error(TAGS.api, 'users/geofence [DELETE]', e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// DELETE /api/v1/users/geofence/:fenceId -> delete a single fence by ID
router.delete('/geofence/:fenceId', requireAuth, requirePerm('fenceEditor'), async (req, res) => {
  const { fenceId } = req.params
  try {
    // resolve user key
    let userIdStr = `${
      req?.user?.discordId || req?.user?.telegramId || req?.user?.username || req?.user?.id || ''
    }`
    if (!userIdStr) {
      try {
        const fullUser = req?.user?.id ? await state.db.models.User.query().findById(req.user.id) : null
        userIdStr = `${
          fullUser?.discordId || fullUser?.telegramId || fullUser?.username || fullUser?.id || ''
        }`
      } catch (_) {}
    }
    if (!userIdStr) {
      return res.status(400).json({ status: 'error', reason: 'Cannot resolve user id' })
    }

    const db = getKojiKnex()
    
    // Verify fence exists and user owns it
    const fence = await db('geofence').where('id', fenceId).first()
    if (!fence) {
      return res.status(404).json({ status: 'error', reason: 'Fence not found' })
    }

    // Check if user owns this fence
    const owner = await getFenceProperty(parseInt(fenceId, 10), 'owner_user_id')
    if (owner !== userIdStr) {
      return res.status(403).json({ status: 'error', reason: 'Du bist nicht der Eigentümer dieser Fence' })
    }

    // Check if other users have workers assigned to this fence
    const { getFenceContributors } = require('../../../services/workerManager')
    const contributors = await getFenceContributors(parseInt(fenceId, 10))
    const otherContributors = contributors.filter(c => c.userId !== userIdStr && c.workers > 0)
    
    if (otherContributors.length > 0) {
      // Other users have workers - cannot delete, must transfer ownership
      const totalOtherWorkers = otherContributors.reduce((sum, c) => sum + c.workers, 0)
      const contributorNames = otherContributors.map(c => `${c.userId} (${c.workers} Worker)`).join(', ')
      
      return res.status(400).json({ 
        status: 'error', 
        reason: `Diese Fence kann nicht gelöscht werden, da andere User Worker zugewiesen haben: ${contributorNames}. Entferne zuerst deine eigenen Worker, dann wird die Ownership automatisch übertragen.`
      })
    }

    // Get Dragonite area ID before deleting
    const dragoniteAreaId = await getFenceProperty(parseInt(fenceId, 10), 'dragonite_area_id')

    // Step 1: Delete from Koji (only if no other contributors)
    await db.transaction(async (knex) => {
      // Delete fence_workers entries
      await knex('fence_workers').where('fence_id', fenceId).del()
      
      // Delete properties
      await knex('geofence_property').where('geofence_id', fenceId).del()
      
      // Delete project links
      await knex('geofence_project').where('geofence_id', fenceId).del()
      
      // Delete the fence itself
      await knex('geofence').where('id', fenceId).del()
    })

    log.info(TAGS.api, `Deleted Koji fence ${fenceId} for user ${userIdStr}`)

    // Step 2: Delete from Dragonite (if area ID exists)
    let dragoniteError
    if (dragoniteAreaId) {
      try {
        const delResult = await deleteDragoniteArea(dragoniteAreaId)
        if (!delResult.success) {
          dragoniteError = delResult.error
          log.warn(TAGS.api, `Failed to delete Dragonite area ${dragoniteAreaId}: ${delResult.error}`)
        } else {
          log.info(TAGS.api, `Deleted Dragonite area ${dragoniteAreaId}`)
        }
      } catch (e) {
        dragoniteError = e.message
        log.error(TAGS.api, `Exception deleting Dragonite area ${dragoniteAreaId}`, e)
      }
    }

    // Reload areas
    try {
      const newAreas = await loadLatestAreas()
      config.setAreas(newAreas)
    } catch (e) {
      log.warn(TAGS.api, 'users/geofence/:fenceId [DELETE] reload failed', e?.message || e)
    }

    // Return result
    if (dragoniteError) {
      return res.status(207).json({
        status: 'partial',
        message: 'Fence in Koji gelöscht, aber Dragonite-Synchronisation fehlgeschlagen.',
        error: dragoniteError,
      })
    }

    res.status(200).json({ status: 'ok', message: 'Fence erfolgreich gelöscht' })
    log.info(TAGS.api, `users/geofence/${fenceId} [DELETE] success`)
  } catch (e) {
    log.error(TAGS.api, `users/geofence/${req.params.fenceId} [DELETE]`, e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})


router.get('/export', async (req, res) => {
  try {
    /** @type {import('@rm/types').FullUser[]} */
    const users = await state.db.models.User.query()

    const badges = {}

    /** @type {import('@rm/types').FullGymBadge[]} */
    const rawBadges = await state.db.models.Badge.query()
    // eslint-disable-next-line no-unused-vars
    rawBadges.forEach(({ userId, id, ...rest }) => {
      if (!badges[userId]) {
        badges[userId] = []
      }
      badges[userId].push(rest)
    })

    const backups = {}
    /** @type {import('@rm/types').FullBackup[]} */
    const rawBackups = await state.db.models.Backup.query()

    // eslint-disable-next-line no-unused-vars
    rawBackups.forEach(({ userId, id, ...rest }) => {
      if (!backups[userId]) {
        backups[userId] = []
      }
      backups[userId].push(rest)
    })

    const data = users.map(({ id, ...rest }) => ({
      ...rest,
      badges: badges[id] || [],
      backups: backups[id] || [],
    }))
    res.status(200).json(data)
    log.info(TAGS.api, 'api/v1/users')
  } catch (e) {
    log.error(TAGS.api, 'api/v1/users/export', e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

router.post('/import', async (req, res) => {
  try {
    const { body } = req
    const bodyArray = Array.isArray(body) ? body : [body]

    /**
     * @param {import('@rm/types').User} user
     * @returns {Promise<import('@rm/types').FullUser>}
     */
    const getUser = async (user) => {
      if (user.username) {
        const found = await state.db.models.User.query().select().findOne({
          username: user.username,
        })
        if (found) return found
      }
      if (user.discordId) {
        const found = await state.db.models.User.query().select().findOne({
          discordId: user.discordId,
        })
        if (found) return found
      }
      if (user.telegramId) {
        const found = await state.db.models.User.query().select().findOne({
          telegramId: user.telegramId,
        })
        if (found) return found
      }
      return state.db.models.User.query().insert(user)
    }

    for (const { backups, badges, ...user } of bodyArray) {
      const userEntry = await getUser(user)

      log.info(
        TAGS.api,
        'Inserted User',
        userEntry.id,
        userEntry.username || userEntry.discordId || userEntry.telegramId,
      )

      if (badges) {
        for (const badge of badges) {
          await state.db.models.Badge.query().insert({
            ...badge,
            userId: userEntry.id,
          })
        }
      }
      if (backups) {
        for (const backup of backups) {
          await state.db.models.Backup.query().insert({
            ...backup,
            userId: userEntry.id,
          })
        }
      }
    }
    res.status(200).json({ status: 'success' })
    log.info(TAGS.api, 'api/v1/users/import')
  } catch (e) {
    log.error(TAGS.api, 'api/v1/users/import', e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// moved lower to avoid catching '/geofence' as ':id'

router.get('/discord/:id', async (req, res) => {
  try {
    const user = await state.db.models.User.query()
      .where('discordId', req.params.id)
      .first()
    res.status(200).json(user || { status: 'error', reason: 'User Not Found' })
    log.info(TAGS.api, `api/v1/users/discord/${req.params.id}`)
  } catch (e) {
    log.error(TAGS.api, `api/v1/users/discord/${req.params.id}`, e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

router.get('/telegram/:id', async (req, res) => {
  try {
    const user = await state.db.models.User.query()
      .where('telegramId', req.params.id)
      .first()
    res.status(200).json(user || { status: 'error', reason: 'User Not Found' })
    log.info(TAGS.api, `api/v1/users/telegram/${req.params.id}`)
  } catch (e) {
    log.error(TAGS.api, `api/v1/users/telegram/${req.params.id}`, e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// --- Koji Geofence Endpoints ---
// GET /api/v1/users/geofence -> list fences for the logged-in user (by project name = user id)
router.get('/geofence', requireAuth, async (req, res) => {
  try {
    const db = getKojiKnex()

    // resolve user id string to use as project name
    let userIdStr = `${
      req?.user?.discordId || req?.user?.telegramId || req?.user?.username || req?.user?.id || ''
    }`
    if (!userIdStr) {
      // attempt to resolve via reactmap DB
      try {
        const fullUser = req?.user?.id
          ? await state.db.models.User.query().findById(req.user.id)
          : null
        userIdStr = `${
          (fullUser && (fullUser['discordId'] || fullUser['telegramId'] || fullUser['username'] || fullUser['id'])) || ''
        }`
      } catch (_) {}
    }
    if (!userIdStr) {
      log.warn(TAGS.api, 'api/v1/users/geofence [GET] no userId; returning empty set')
      return res.status(200).json({ type: 'FeatureCollection', features: [] })
    }

    let userProject = await db('project').select('id').where('name', userIdStr).first()
    if (!userProject && req?.user?.id) {
      // Try a last fallback to internal numeric id as string
      userProject = await db('project').select('id').where('name', String(req.user.id)).first()
    }
    if (!userProject) {
      log.info(TAGS.api, 'api/v1/users/geofence [GET] project not found for', userIdStr)
      return res.status(200).json({ features: [], type: 'FeatureCollection' })
    }

    const rows = await db('geofence as g')
      .join('geofence_project as gp', 'gp.geofence_id', 'g.id')
      .where('gp.project_id', userProject.id)
      .select('g.id', 'g.name', 'g.mode', 'g.geometry', 'g.parent', 'g.created_at', 'g.updated_at')
      .orderBy('g.updated_at', 'desc')

    // Return as FeatureCollection of GeoJSON geometries with properties
    const features = rows.map((r) => {
      let geometry
      try {
        geometry = typeof r.geometry === 'string' ? JSON.parse(r.geometry) : r.geometry
      } catch (e) {
        geometry = null
      }
      // Remove selfmap_ prefix from name for display
      const displayName = r.name && r.name.startsWith('selfmap_') 
        ? r.name.substring(8) 
        : r.name
      return {
        type: 'Feature',
        geometry,
        properties: {
          id: r.id,
          name: displayName,
          mode: r.mode,
          parent: r.parent,
          created_at: r.created_at,
          updated_at: r.updated_at,
        },
      }
    })

    res.set('X-User-Key', userIdStr)
    res.set('X-User-Project-Id', String(userProject.id))
    res.status(200).json({ type: 'FeatureCollection', features })
    log.info(TAGS.api, 'api/v1/users/geofence [GET]', userIdStr, features.length)
  } catch (e) {
    log.error(TAGS.api, 'api/v1/users/geofence [GET]', e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// POST /api/v1/users/geofence -> create a fence in BOTH Koji and Dragonite
router.post('/geofence', requireAuth, requirePerm('fenceEditor'), async (req, res) => {
  const trxDb = getKojiKnex()
  const { name, geometry, mode } = req.body || {}
  try {
    if (!name) return res.status(400).json({ status: 'error', reason: 'Missing name' })
    if (!geometry) return res.status(400).json({ status: 'error', reason: 'Missing geometry' })

    let userIdStr = `${
      req?.user?.discordId || req?.user?.telegramId || req?.user?.username || req?.user?.id || ''
    }`
    if (!userIdStr) {
      try {
        const fullUser = req?.user?.id
          ? await state.db.models.User.query().findById(req.user.id)
          : null
        userIdStr = `${
          fullUser?.discordId || fullUser?.telegramId || fullUser?.username || fullUser?.id || ''
        }`
      } catch (_) {}
    }
    if (!userIdStr) {
      return res.status(400).json({ status: 'error', reason: 'No logged-in user' })
    }

    // Check if user has available workers to create a new fence
    const workerStats = await getUserWorkerStats(userIdStr)
    
    // User needs at least 1 available worker to create a fence
    // (They can assign workers later, but need capacity to create)
    if (workerStats.available < 1) {
      return res.status(400).json({ 
        status: 'error', 
        reason: `Du hast keine verfügbaren Worker mehr (${workerStats.allocated}/${workerStats.total} zugewiesen). Entferne Worker von anderen Fences oder lösche eine Fence, um eine neue zu erstellen.`
      })
    }

    // Normalize geometry
    let geometryJson
    let geometryObj
    if (typeof geometry === 'string') {
      try {
        const parsed = JSON.parse(geometry)
        geometryObj = parsed && parsed.type && parsed.coordinates
          ? { coordinates: parsed.coordinates, type: parsed.type }
          : parsed
        geometryJson = JSON.stringify(geometryObj)
      } catch {
        geometryJson = geometry
        geometryObj = JSON.parse(geometry)
      }
    } else {
      geometryObj = geometry && geometry.type && geometry.coordinates
        ? { coordinates: geometry.coordinates, type: geometry.type }
        : geometry
      geometryJson = JSON.stringify(geometryObj)
    }

    // Step 1: Koji Transaction (delete old + create new)
    let kojiId
    await trxDb.transaction(async (knex) => {
      // ensure user project
      let userProject = await knex('project').select('id').where('name', userIdStr).first()
      if (!userProject) {
        await knex('project').insert({ name: userIdStr })
        userProject = await knex('project').select('id').where('name', userIdStr).first()
      }

      // resolve system projects
      const reactmap = await knex('project').select('id').where('name', 'reactmap').first()
      const poracle = await knex('project').select('id').where('name', 'poracle').first()
      const selfmap = await knex('project').select('id').where('name', 'selfmap').first()

      // NOTE: No longer deleting old fences - users can have multiple fences now
      // Limited by worker count (checked above)

      // insert new geofence
      const [insertId] = await knex('geofence').insert({
        name: `selfmap_${name}`,
        mode: mode && ['auto_quest', 'auto_pokemon', 'auto_tth', 'pokemon_iv', 'unset'].includes(mode)
          ? mode
          : 'auto_quest',
        geometry: geometryJson,
        parent: null,
        created_at: knex.fn.now(),
        updated_at: knex.fn.now(),
      })

      kojiId = insertId
      if (!kojiId) {
        const rawResult = await knex.raw('SELECT LAST_INSERT_ID() as id')
        if (rawResult && rawResult[0] && rawResult[0][0] && rawResult[0][0].id) {
          kojiId = rawResult[0][0].id
        }
      }

      // link projects (userid, reactmap, poracle, selfmap)
      const projectTargets = [userProject, reactmap, poracle, selfmap].filter(Boolean)
      for (const proj of projectTargets) {
        const exists = await knex('geofence_project')
          .where({ geofence_id: kojiId, project_id: proj.id })
          .first()
        if (!exists) {
          await knex('geofence_project').insert({ geofence_id: kojiId, project_id: proj.id })
        }
      }

      // create geofence property
      try {
        let prop = await knex('property').select('id').where('name', 'name').first().catch(() => null)
        const propertyId = (prop && prop.id) ? prop.id : 21
        // Add leading underscore to name for Poracle filtering
        const nameWithUnderscore = `_${name}`
        await knex('geofence_property').insert({
          geofence_id: kojiId,
          property_id: propertyId,
          value: nameWithUnderscore,
        })
      } catch (propErr) {
        log.warn(TAGS.api, 'users/geofence insert geofence_property failed', propErr?.message || propErr)
      }
    })

    log.info(TAGS.api, `Created Koji fence ${kojiId} for user ${userIdStr}`)

    // Step 1.5: Set ReactMap properties and assign 1 worker automatically
    try {
      await setFenceProperty(kojiId, 'owner_user_id', userIdStr)
      await setFenceProperty(kojiId, 'last_worker_activity', new Date().toISOString())
      // Also store a readable owner display name
      try {
        let ownerName = String(userIdStr)
        if (state?.db?.models?.User) {
          let user = null
          if (/^\d+$/.test(String(userIdStr))) {
            user = await state.db.models.User.query()
              .where('discordId', userIdStr)
              .orWhere('telegramId', userIdStr)
              .first()
              .catch(() => null)
          }
          if (!user && req?.user?.id) {
            user = await state.db.models.User.query().findById(req.user.id).catch(() => null)
          }
          if (!user && req?.user?.username) {
            user = { username: req.user.username }
          }
          if (user && user.username) {
            ownerName = user.username
          }
        }
        await setFenceProperty(kojiId, 'owner_display_name', ownerName)
      } catch (_) {}
      
      // Automatically assign 1 worker to the new fence
      const { adjustFenceWorkers } = require('../../../services/workerManager')
      await adjustFenceWorkers(kojiId, userIdStr, 1)
      log.info(TAGS.api, `Assigned 1 worker to fence ${kojiId}`)
    } catch (propErr) {
      log.warn(TAGS.api, 'Failed to set ReactMap properties or assign worker', propErr?.message || propErr)
    }

    // Step 2: Dragonite creation handled by adjustFenceWorkers when assigning first worker
    // Read current dragonite area id from properties for response
    let dragoniteId = await getFenceProperty(kojiId, 'dragonite_area_id')
    let dragoniteError = null

    // Reload ReactMap areas
    try {
      const newAreas = await loadLatestAreas()
      config.setAreas(newAreas)
    } catch (e) {
      log.warn(TAGS.api, 'Area reload failed', e?.message || e)
    }

    // Reload Poracle geofences
    try {
      const webhooks = config.getSafe('webhooks') || []
      for (const webhook of webhooks) {
        if (webhook.enabled && webhook.provider === 'poracle' && webhook.host && webhook.port && webhook.poracleSecret) {
          const poracleUrl = `${webhook.host}:${webhook.port}/api/geofence/reload`
          const poracleResp = await fetch(poracleUrl, {
            method: 'GET',
            headers: {
              'X-Poracle-Secret': webhook.poracleSecret,
            },
          })
          if (poracleResp.ok) {
            log.info(TAGS.api, `Poracle geofence reload successful for ${webhook.name || webhook.host}`)
            
            // Reload Poracle geojson in ReactMap
            try {
              const webhookObj = state.event?.webhookObj?.[webhook.name]
              if (webhookObj && typeof webhookObj.init === 'function') {
                await webhookObj.init()
                log.info(TAGS.api, `Poracle webhook ${webhook.name} reinitialized in ReactMap`)
              }
            } catch (reinitErr) {
              log.warn(TAGS.api, `Failed to reinitialize Poracle webhook ${webhook.name}:`, reinitErr?.message || reinitErr)
            }
          } else {
            const text = await poracleResp.text().catch(() => '')
            log.warn(TAGS.api, `Poracle geofence reload failed for ${webhook.name || webhook.host}: ${poracleResp.status} ${text}`)
          }
        }
      }
    } catch (e) {
      log.warn(TAGS.api, 'Poracle geofence reload failed', e?.message || e)
    }

    // Return result
    if (dragoniteError) {
      return res.status(207).json({
        status: 'partial',
        kojiId,
        dragoniteId: null,
        error: `Koji OK, Dragonite failed: ${dragoniteError}`,
        message: 'Fence in Koji erstellt, aber Dragonite-Synchronisation fehlgeschlagen. Bitte Admin kontaktieren.',
      })
    }

    res.status(201).json({ status: 'ok', kojiId, dragoniteId })
    log.info(TAGS.api, 'api/v1/users/geofence [POST] success', name)
  } catch (e) {
    log.error(TAGS.api, 'api/v1/users/geofence [POST]', e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// ============================================================================
// PORACLE GEOFENCE ENDPOINT
// ============================================================================

// GET /api/v1/geofence/poracle/:project - Return all geofences for Poracle
router.get('/geofence/poracle/:project', async (req, res) => {
  try {
    const { project } = req.params
    const { group } = req.query
    const db = getKojiKnex()

    // Get all geofences from all projects (Poracle needs to see all fences)
    const rows = await db('geofence as g')
      .select('g.id', 'g.name', 'g.mode', 'g.geometry', 'g.parent', 'g.created_at', 'g.updated_at')
      .orderBy('g.name', 'asc')

    // Convert to GeoJSON FeatureCollection
    const features = rows.map((r) => {
      let geometry
      try {
        geometry = typeof r.geometry === 'string' ? JSON.parse(r.geometry) : r.geometry
      } catch (e) {
        geometry = null
      }
      
      // Extract group from name (e.g., "selfmap_Test_PL" -> group: "selfmap")
      let groupName = 'default'
      if (r.name && r.name.includes('_')) {
        const parts = r.name.split('_')
        if (parts.length >= 2) {
          groupName = parts[0]
        }
      }

      return {
        type: 'Feature',
        geometry,
        properties: {
          name: r.name,
          path: r.name,
          group: group === 'true' ? groupName : undefined,
        },
      }
    })

    const response = {
      geoJSON: {
        type: 'FeatureCollection',
        features,
      },
    }

    res.status(200).json(response)
    log.info(TAGS.api, `api/v1/geofence/poracle/${project} [GET]`, features.length, 'fences')
  } catch (e) {
    log.error(TAGS.api, 'api/v1/geofence/poracle/:project [GET]', e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// ============================================================================
// WORKER MANAGEMENT ENDPOINTS
// ============================================================================

// GET /api/v1/users/me/workers - Get current user's worker statistics
router.get('/me/workers', requireAuth, async (req, res) => {
  try {
    const userId = `${
      req?.user?.discordId || req?.user?.telegramId || req?.user?.username || req?.user?.id || ''
    }`
    if (!userId) {
      return res.status(400).json({ status: 'error', reason: 'No logged-in user' })
    }

    const stats = await getUserWorkerStats(userId)
    res.status(200).json(stats)
    log.info(TAGS.api, `api/v1/users/me/workers [GET] for user ${userId}`)
  } catch (e) {
    log.error(TAGS.api, 'api/v1/users/me/workers [GET]', e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// POST /api/v1/users/fence/:fenceId/workers - Adjust worker assignment
router.post('/fence/:fenceId/workers', requireAuth, async (req, res) => {
  const { fenceId } = req.params
  const { workerDelta } = req.body

  try {
    const userId = `${
      req?.user?.discordId || req?.user?.telegramId || req?.user?.username || req?.user?.id || ''
    }`
    if (!userId) {
      return res.status(400).json({ status: 'error', reason: 'No logged-in user' })
    }

    if (typeof workerDelta !== 'number' || workerDelta === 0) {
      return res.status(400).json({ 
        status: 'error', 
        reason: 'workerDelta must be a non-zero number' 
      })
    }

    const result = await adjustFenceWorkers(parseInt(fenceId, 10), userId, workerDelta)
    
    res.status(200).json({ 
      status: 'ok', 
      ...result 
    })
    log.info(TAGS.api, `api/v1/users/fence/${fenceId}/workers [POST] ${workerDelta > 0 ? '+' : ''}${workerDelta} workers for user ${userId}`)
  } catch (e) {
    log.error(TAGS.api, `api/v1/users/fence/${fenceId}/workers [POST]`, e)
    res.status(400).json({ status: 'error', reason: e.message })
  }
})

// GET /api/v1/users/fence/:fenceId/contributors - Get all contributors for a fence
router.get('/fence/:fenceId/contributors', async (req, res) => {
  const { fenceId } = req.params

  try {
    const contributors = await getFenceContributors(parseInt(fenceId, 10))
    
    // Get fence info
    const knex = getKojiKnex()
    const fence = await knex('geofence').where('id', fenceId).select('name').first()
    
    if (!fence) {
      return res.status(404).json({ status: 'error', reason: 'Fence not found' })
    }

    const totalWorkers = await getFenceProperty(parseInt(fenceId, 10), 'total_workers', '0')
    const owner = await getFenceProperty(parseInt(fenceId, 10), 'owner_user_id')
    let ownerName = await getFenceProperty(parseInt(fenceId, 10), 'owner_display_name')
    if (!ownerName && owner) {
      try {
        if (state?.db?.models?.User) {
          let user = null
          if (/^\d+$/.test(String(owner))) {
            user = await state.db.models.User.query()
              .where('discordId', owner)
              .orWhere('telegramId', owner)
              .first()
              .catch(() => null)
          }
          if (!user) {
            user = await state.db.models.User.query()
              .where('username', owner)
              .first()
              .catch(() => null)
          }
          if (user && user.username) {
            ownerName = user.username
          }
        }
      } catch (_) {
        // ignore name resolution failure
      }
    }

    res.status(200).json({
      fenceId: parseInt(fenceId, 10),
      fenceName: fence.name,
      owner,
      ownerName,
      totalWorkers: parseInt(totalWorkers, 10),
      contributors,
    })
    log.info(TAGS.api, `api/v1/users/fence/${fenceId}/contributors [GET]`)
  } catch (e) {
    log.error(TAGS.api, `api/v1/users/fence/${fenceId}/contributors [GET]`, e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// GET /api/v1/users/fences/public - Get all public fences with worker info (only selfmap fences)
// Optional query params: ?lat=X&lng=Y for distance-based sorting
router.get('/fences/public', requireAuth, requirePerm('publicFences'), async (req, res) => {
  try {
    const knex = getKojiKnex()
    
    // Get optional lat/lng for distance sorting
    const userLat = req.query.lat ? parseFloat(String(req.query.lat)) : null
    const userLng = req.query.lng ? parseFloat(String(req.query.lng)) : null
    
    // Get selfmap project ID
    const selfmapProject = await knex('project').select('id').where('name', 'selfmap').first()
    
    if (!selfmapProject) {
      log.warn(TAGS.api, 'api/v1/users/fences/public [GET] selfmap project not found, returning empty')
      return res.status(200).json([])
    }
    
    // Get all fences linked to selfmap project
    const fences = await knex('geofence')
      .select('geofence.id', 'geofence.name', 'geofence.geometry', 'geofence.mode', 'geofence.created_at', 'geofence.updated_at')
      .join('geofence_project', 'geofence.id', 'geofence_project.geofence_id')
      .where('geofence_project.project_id', selfmapProject.id)
      .orderBy('geofence.name', 'asc')

    // Enrich with worker info
    const fencesWithWorkers = await Promise.all(
      fences.map(async (fence) => {
        const owner = await getFenceProperty(fence.id, 'owner_user_id')
        let ownerName = await getFenceProperty(fence.id, 'owner_display_name')
        if (!ownerName && owner) {
          try {
            if (state?.db?.models?.User) {
              let user = null
              if (/^\d+$/.test(String(owner))) {
                user = await state.db.models.User.query()
                  .where('discordId', owner)
                  .orWhere('telegramId', owner)
                  .first()
                  .catch(() => null)
              }
              if (!user) {
                user = await state.db.models.User.query()
                  .where('username', owner)
                  .first()
                  .catch(() => null)
              }
              if (user && user.username) {
                ownerName = user.username
              }
            }
          } catch (_) {}
        }
        const totalWorkers = await getFenceProperty(fence.id, 'total_workers', '0')
        const lastActivity = await getFenceProperty(fence.id, 'last_worker_activity')
        const dragoniteAreaId = await getFenceProperty(fence.id, 'dragonite_area_id')
        
        const contributors = await getFenceContributors(fence.id)

        return {
          id: fence.id,
          name: fence.name,
          mode: fence.mode,
          owner,
          ownerName,
          totalWorkers: parseInt(totalWorkers, 10),
          lastActivity,
          dragoniteAreaId: dragoniteAreaId ? parseInt(dragoniteAreaId, 10) : null,
          contributorCount: contributors.length,
          geometry: fence.geometry,
          created_at: fence.created_at,
          updated_at: fence.updated_at,
        }
      }),
    )

    // Sort by distance if lat/lng provided
    if (userLat !== null && userLng !== null) {
      // Haversine formula to calculate distance in kilometers
      const haversineDistance = (lat1, lon1, lat2, lon2) => {
        const R = 6371 // Earth radius in kilometers
        const dLat = (lat2 - lat1) * Math.PI / 180
        const dLon = (lon2 - lon1) * Math.PI / 180
        const a = 
          Math.sin(dLat / 2) * Math.sin(dLat / 2) +
          Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
          Math.sin(dLon / 2) * Math.sin(dLon / 2)
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
        return R * c
      }
      
      fencesWithWorkers.forEach(fence => {
        // Calculate centroid of fence
        let fenceCenter = null
        try {
          const geom = typeof fence.geometry === 'string' ? JSON.parse(fence.geometry) : fence.geometry
          if (geom && geom.coordinates) {
            const coords = geom.type === 'Polygon' 
              ? geom.coordinates[0] 
              : (geom.type === 'MultiPolygon' ? geom.coordinates[0][0] : null)
            
            if (coords && coords.length > 0) {
              const sumLat = coords.reduce((sum, c) => sum + c[1], 0)
              const sumLng = coords.reduce((sum, c) => sum + c[0], 0)
              fenceCenter = {
                lat: sumLat / coords.length,
                lng: sumLng / coords.length
              }
            }
          }
        } catch (e) {
          // Ignore parse errors
        }
        
        // Calculate distance in kilometers
        if (fenceCenter) {
          const distanceKm = haversineDistance(userLat, userLng, fenceCenter.lat, fenceCenter.lng)
          fence.distanceKm = Math.round(distanceKm * 10) / 10 // Round to 1 decimal
          fence._distance = distanceKm // For sorting
        } else {
          fence.distanceKm = null
          fence._distance = Infinity
        }
      })
      
      // Sort by distance (closest first)
      fencesWithWorkers.sort((a, b) => a._distance - b._distance)
      
      log.info(TAGS.api, `api/v1/users/fences/public [GET] returned ${fencesWithWorkers.length} fences (sorted by distance)`)
    } else {
      log.info(TAGS.api, `api/v1/users/fences/public [GET] returned ${fencesWithWorkers.length} fences`)
    }

    res.status(200).json(fencesWithWorkers)
  } catch (e) {
    log.error(TAGS.api, 'api/v1/users/fences/public [GET]', e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// POST /api/v1/users/fence/:fenceId/sync-workers - Sync workers from Dragonite
router.post('/fence/:fenceId/sync-workers', requireAuth, async (req, res) => {
  const { fenceId } = req.params

  try {
    const userId = `${
      req?.user?.discordId || req?.user?.telegramId || req?.user?.username || req?.user?.id || ''
    }`
    if (!userId) {
      return res.status(400).json({ status: 'error', reason: 'No logged-in user' })
    }

    const knex = getKojiKnex()

    // Get fence and dragonite area ID
    const dragoniteAreaId = await getFenceProperty(parseInt(fenceId, 10), 'dragonite_area_id')
    if (!dragoniteAreaId) {
      return res.status(400).json({ status: 'error', reason: 'No Dragonite area linked' })
    }

    // Get worker count from Dragonite
    const dg = config.getSafe('integrations.dragonite') || {}
    const baseUrl = dg.baseUrl
    if (!baseUrl) {
      return res.status(400).json({ status: 'error', reason: 'Dragonite not configured' })
    }

    const headers = {}
    if (dg.instance) headers['x-backend-instance'] = String(dg.instance)
    if (dg.authHeaderName && dg.authHeaderValue) {
      headers[dg.authHeaderName] = dg.authHeaderValue
    }

    const resp = await fetch(`${baseUrl}/areas/${dragoniteAreaId}`, {
      method: 'GET',
      headers,
    })

    if (!resp.ok) {
      return res.status(400).json({ status: 'error', reason: 'Failed to fetch Dragonite area' })
    }

    const areaData = await resp.json()
    const workerCount = areaData?.pokemon_mode?.workers || 0

    if (workerCount > 0) {
      // Check if user already has workers assigned
      const existing = await knex('fence_workers')
        .where({ fence_id: fenceId, user_id: userId })
        .first()

      if (!existing) {
        // Create worker assignment
        await knex('fence_workers').insert({
          fence_id: fenceId,
          user_id: userId,
          worker_count: workerCount,
        })

        // Update fence properties
        await setFenceProperty(parseInt(fenceId, 10), 'total_workers', workerCount)
        await setFenceProperty(parseInt(fenceId, 10), 'last_worker_activity', new Date().toISOString())
        await setFenceProperty(parseInt(fenceId, 10), 'owner_user_id', userId)
        // Also store a readable owner display name
        try {
          let ownerName = String(userId)
          if (state?.db?.models?.User) {
            let user = null
            if (/^\d+$/.test(String(userId))) {
              user = await state.db.models.User.query()
                .where('discordId', userId)
                .orWhere('telegramId', userId)
                .first()
                .catch(() => null)
            }
            if (!user && req?.user?.id) {
              user = await state.db.models.User.query().findById(req.user.id).catch(() => null)
            }
            if (!user && req?.user?.username) {
              user = { username: req.user.username }
            }
            if (user && user.username) {
              ownerName = user.username
            }
          }
          await setFenceProperty(parseInt(fenceId, 10), 'owner_display_name', ownerName)
        } catch (_) {}

        log.info(TAGS.api, `Synced ${workerCount} workers from Dragonite for fence ${fenceId}`)
      }
    }

    res.status(200).json({ 
      status: 'ok', 
      synced: workerCount,
      message: `${workerCount} Worker synchronisiert`
    })
  } catch (e) {
    log.error(TAGS.api, `api/v1/users/fence/${req.params.fenceId}/sync-workers [POST]`, e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// ============================================================================
// END WORKER MANAGEMENT ENDPOINTS
// ============================================================================

// Place generic id route at the very end to avoid conflicts with specific routes like '/geofence'
router.get('/:id', async (req, res) => {
  try {
    const user = await state.db.models.User.query().findById(req.params.id)
    res.status(200).json(user || { status: 'error', reason: 'User Not Found' })
    log.info(TAGS.api, `api/v1/users/${req.params.id}`)
  } catch (e) {
    log.error(TAGS.api, `api/v1/users/${req.params.id}`, e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

module.exports = router
