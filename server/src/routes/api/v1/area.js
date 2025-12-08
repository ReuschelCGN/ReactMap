const router = require('express').Router()
const { requireAuth } = require('../../../middleware/requireAuth')

const config = require('@rm/config')
const { log, TAGS } = require('@rm/logger')
const { loadLatestAreas } = require('../../../services/areas')
const { getKojiKnex } = require('../../../services/kojiDb')

router.get('/reload', async (req, res) => {
  try {
    const newAreas = await loadLatestAreas()
    config.setAreas(newAreas)

    res.status(200).json({ status: 'ok', message: 'reloaded areas' })
  } catch (e) {
    log.error(TAGS.api, req.originalUrl, e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// DELETE /api/v1/area/dragonite/areas -> bulk delete all areas owned by current user (by naming pattern)
router.delete('/dragonite/areas', requireAuth, async (req, res) => {
  try {
    const { baseUrl, headers, policy } = buildDragoniteHeaders()
    if (!baseUrl) return res.status(500).json({ status: 'error', reason: 'Dragonite baseUrl missing' })

    // resolve current user key
    const me = req.user || {}
    const userKey = `${me.discordId || me.telegramId || me.username || me.id || ''}`
    if (!userKey) return res.status(400).json({ status: 'error', reason: 'Cannot resolve user id for ownership' })

    // Repeatedly list (paginated) and delete until no matches remain
    let requested = 0
    let matchedTotal = 0
    let deleted = 0
    const maxPasses = 10
    for (let pass = 0; pass < maxPasses; pass += 1) {
      let page = 0
      let foundOnThisPass = 0
      // page through the list
      for (let pageSafety = 0; pageSafety < 200; pageSafety += 1) {
        const listUrl = `${baseUrl}/areas/?order=ASC&page=${page}&perPage=1000&sortBy=name`
        const listRes = await fetch(listUrl, { method: 'GET', headers })
        if (!listRes.ok) {
          const txt = await listRes.text().catch(() => '')
          if (pass === 0 && page === 0) {
            return res.status(listRes.status).json({ status: 'error', reason: txt || 'Dragonite list failed' })
          }
          break
        }
        let payload
        try { payload = await listRes.json() } catch { payload = [] }
        /** @type {Array<{id:string|number,name:string}>} */
        const rows = Array.isArray(payload)
          ? payload
          : (Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload?.data) ? payload.data : []))
        const hasNext = Boolean(payload?.pagination?.hasNext)
        requested += rows.length

        const mine = (rows || []).filter((a) => {
          const nm = String(a?.name || '')
          if (!nm) return false
          if (policy?.namingPattern === 'userid_name') return nm.startsWith(`${userKey}_`)
          return nm.startsWith(`${userKey}_`)
        })
        matchedTotal += mine.length
        foundOnThisPass += mine.length

        for (const a of mine) {
          try {
            const url = `${baseUrl}/areas/${encodeURIComponent(String(a.id))}`
            const delRes = await fetch(url, { method: 'DELETE', headers })
            if (delRes.ok) deleted += 1
            else {
              const body = await delRes.text().catch(() => '')
              log.warn(TAGS.api, 'dragonite delete non-ok', a?.id, delRes.status, body)
            }
          } catch (e) {
            log.warn(TAGS.api, 'dragonite bulk delete failed for', a?.id, e?.message || e)
          }
        }

        if (!hasNext) break
        page += 1
      }
      // if this pass found nothing to delete, we are done
      if (foundOnThisPass === 0) break
      // otherwise: repeat passes to catch any races or late-created entries
    }

    // Koji cleanup: remove all user-linked geofences
    try {
      const db = getKojiKnex()
      // resolve user project by userKey or numeric id fallback
      let userProject = await db('project').select('id').where('name', userKey).first()
      if (!userProject && req?.user?.id) {
        userProject = await db('project').select('id').where('name', String(req.user.id)).first()
      }
      if (userProject) {
        // collect all geofence ids linked to this project
        const links = await db('geofence_project').select('geofence_id').where('project_id', userProject.id)
        const ids = Array.isArray(links) ? links.map((l) => l.geofence_id).filter(Boolean) : []
        if (ids.length) {
          // delete links first, then properties, then geofences
          await db.transaction(async (knex) => {
            await knex('geofence_project').whereIn('geofence_id', ids).del()
            try { await knex('geofence_property').whereIn('geofence_id', ids).del() } catch (_) {}
            await knex('geofence').whereIn('id', ids).del()
          })
        }
      }
    } catch (kojiErr) {
      log.warn(TAGS.api, 'dragonite bulk delete: Koji cleanup failed', kojiErr?.message || kojiErr)
    }

    // reload ReactMap areas after bulk delete
    try {
      const newAreas = await loadLatestAreas()
      config.setAreas(newAreas)
    } catch (e) {
      log.warn(TAGS.api, 'bulk delete reload failed', e?.message || e)
    }

    res.status(200).json({ status: 'ok', requested, matched: matchedTotal, deleted })
  } catch (e) {
    log.error(TAGS.api, req.originalUrl, e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// GET /api/v1/area/dragonite/areas -> list areas (proxied)
router.get('/dragonite/areas', async (req, res) => {
  try {
    const { baseUrl, headers } = buildDragoniteHeaders()
    if (!baseUrl) return res.status(500).json({ status: 'error', reason: 'Dragonite baseUrl missing' })
    const params = new URLSearchParams()
    const allow = ['order', 'page', 'perPage', 'sortBy', 'q']
    for (const key of allow) {
      const v = req.query[key]
      if (typeof v === 'string') params.set(key, v)
      else if (Array.isArray(v) && v[0]) params.set(key, v[0])
    }
    const url = `${baseUrl}/areas/${params.toString() ? `?${params.toString()}` : ''}`
    const drRes = await fetch(url, { method: 'GET', headers })
    const text = await drRes.text().catch(() => '')
    if (!drRes.ok) return res.status(drRes.status).json({ status: 'error', reason: text || 'Dragonite list failed' })
    let data
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    res.status(200).json({ status: 'ok', data })
  } catch (e) {
    log.error(TAGS.api, req.originalUrl, e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// --- Dragonite Proxy Endpoints ---
// Helpers
function buildDragoniteHeaders() {
  const dg = config.getSafe('integrations.dragonite') || {}
  /** @type {Record<string,string>} */
  const headers = { 'Content-Type': 'application/json' }
  if (dg.instance) headers['x-backend-instance'] = String(dg.instance)
  if (dg.authHeaderName && dg.authHeaderValue) {
    headers[String(dg.authHeaderName)] = String(dg.authHeaderValue)
  }
  return { baseUrl: dg.baseUrl, headers, defaults: dg.defaults || {}, policy: dg.policy || {} }
}

// Create/Activate an area in Dragonite
// POST /api/v1/area/dragonite/areas
// body: { nameBase?: string, geofence: [{lat, lon}], options?: { enable_quests, pokemon_mode, quest_mode } }
router.post('/dragonite/areas', requireAuth, async (req, res) => {
  try {
    const { baseUrl, headers, defaults, policy } = buildDragoniteHeaders()
    if (!baseUrl) return res.status(500).json({ status: 'error', reason: 'Dragonite baseUrl missing' })

    // resolve user id for naming
    const user = req.user || {}
    const userKey = `${user.discordId || user.telegramId || user.username || user.id || ''}`
    const nameBase = req.body?.nameBase || 'fence'
    const finalName = policy?.namingPattern === 'userid_name' && userKey ? `${userKey}_${nameBase}` : nameBase

    // optional previous id to delete first (singleFencePerUser policy)
    const previousId = req.body?.previousId
    if (policy?.singleFencePerUser && previousId) {
      try {
        // Ownership check: only allow deleting previous if this user owns it (by naming pattern)
        const prevRes = await fetch(`${baseUrl}/areas/${encodeURIComponent(previousId)}`, { method: 'GET', headers })
        if (prevRes.ok) {
          const prev = await prevRes.json().catch(() => ({}))
          const prevName = String(prev?.name || '')
          const owns = policy?.namingPattern === 'userid_name' && userKey
            ? prevName.startsWith(`${userKey}_`)
            : true
          if (owns) {
            await fetch(`${baseUrl}/areas/${encodeURIComponent(previousId)}`, { method: 'DELETE', headers })
          } else {
            log.warn(TAGS.api, 'dragonite previousId ownership mismatch; skipping delete', previousId)
          }
        }
      } catch (delErr) {
        log.warn(TAGS.api, 'dragonite delete previous failed', String(previousId), delErr?.message || delErr)
      }
    }

    // build payload
    const payload = {
      name: finalName,
      enabled: true,
      geofence: req.body?.geofence || [],
      enable_quests: defaults?.enable_quests ?? true,
      pokemon_mode: req.body?.options?.pokemon_mode || defaults?.pokemon_mode || { workers: 1, enable_scout: false, invasion: false },
      quest_mode: req.body?.options?.quest_mode || defaults?.quest_mode || { hours: [1, 10] },
    }

    const drRes = await fetch(`${baseUrl}/areas/`, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    })
    if (!drRes.ok) {
      const text = await drRes.text().catch(() => '')
      return res.status(502).json({ status: 'error', reason: 'Dragonite responded with non-OK', code: drRes.status, body: text })
    }
    const data = await drRes.json().catch(() => ({}))

    // Enforce single-fence-per-user: delete any other areas with this user's prefix except the newly created one
    try {
      const createdId = data?.id || data?.data?.id
      if (policy?.singleFencePerUser && userKey) {
        const prefix = `${userKey}_`
        const maxPasses = 5
        for (let pass = 0; pass < maxPasses; pass += 1) {
          let page = 0
          let deletedThisPass = 0
          for (let safety = 0; safety < 200; safety += 1) {
            const listUrl = `${baseUrl}/areas/?order=ASC&page=${page}&perPage=1000&sortBy=name`
            const listRes = await fetch(listUrl, { method: 'GET', headers })
            if (!listRes.ok) break
            let payloadJson
            try { payloadJson = await listRes.json() } catch { payloadJson = [] }
            const rows = Array.isArray(payloadJson)
              ? payloadJson
              : (Array.isArray(payloadJson?.items) ? payloadJson.items : (Array.isArray(payloadJson?.data) ? payloadJson.data : []))
            const hasNext = Boolean(payloadJson?.pagination?.hasNext)
            const mine = (rows || []).filter((a) => String(a?.name || '').startsWith(prefix))
            for (const a of mine) {
              const aid = String(a?.id)
              if (!aid || (createdId && String(createdId) === aid)) continue
              try {
                const delUrl = `${baseUrl}/areas/${encodeURIComponent(aid)}`
                const delRes = await fetch(delUrl, { method: 'DELETE', headers })
                if (delRes.ok) deletedThisPass += 1
              } catch (_) {}
            }
            if (!hasNext) break
            page += 1
          }
          if (deletedThisPass === 0) break
        }
      }
    } catch (cleanupErr) {
      log.warn(TAGS.api, 'dragonite post-create cleanup failed', cleanupErr?.message || cleanupErr)
    }

    res.status(202).json({ status: 'ok', data })
  } catch (e) {
    log.error(TAGS.api, req.originalUrl, e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// DELETE /api/v1/area/dragonite/areas/:id
router.delete('/dragonite/areas/:id', requireAuth, async (req, res) => {
  try {
    const { baseUrl, headers } = buildDragoniteHeaders()
    if (!baseUrl) return res.status(500).json({ status: 'error', reason: 'Dragonite baseUrl missing' })
    // Ownership check via fetch-and-verify name prefix if policy enforces it
    const me = req.user || {}
    const userKey = `${me.discordId || me.telegramId || me.username || me.id || ''}`
    const policyRes = await fetch(`${baseUrl}/areas/${encodeURIComponent(req.params.id)}`, { method: 'GET', headers })
    if (policyRes.ok) {
      let nameOk = true
      try {
        const area = await policyRes.json()
        const conf = config.getSafe('integrations.dragonite') || {}
        const policy = conf.policy || {}
        if (policy?.enforceOwnership && policy?.namingPattern === 'userid_name' && userKey) {
          nameOk = String(area?.name || '').startsWith(`${userKey}_`)
        }
      } catch (_) {}
      if (!nameOk) return res.status(403).json({ status: 'error', reason: 'Forbidden: not your area' })
    }
    const drRes = await fetch(`${baseUrl}/areas/${encodeURIComponent(req.params.id)}`, { method: 'DELETE', headers })
    if (!drRes.ok) return res.status(drRes.status).json({ status: 'error', reason: 'Dragonite delete failed' })
    res.status(204).send()
  } catch (e) {
    log.error(TAGS.api, req.originalUrl, e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// GET /api/v1/area/dragonite/recalculate/:id
router.get('/dragonite/recalculate/:id', requireAuth, async (req, res) => {
  try {
    const { baseUrl, headers } = buildDragoniteHeaders()
    if (!baseUrl) return res.status(500).json({ status: 'error', reason: 'Dragonite baseUrl missing' })
    // Ownership check
    try {
      const me = req.user || {}
      const userKey = `${me.discordId || me.telegramId || me.username || me.id || ''}`
      const policyRes = await fetch(`${baseUrl}/areas/${encodeURIComponent(req.params.id)}`, { method: 'GET', headers })
      if (policyRes.ok) {
        const area = await policyRes.json().catch(() => ({}))
        const conf = config.getSafe('integrations.dragonite') || {}
        const policy = conf.policy || {}
        if (policy?.enforceOwnership && policy?.namingPattern === 'userid_name' && userKey) {
          const nameOk = String(area?.name || '').startsWith(`${userKey}_`)
          if (!nameOk) return res.status(403).json({ status: 'error', reason: 'Forbidden: not your area' })
        }
      }
    } catch (_) {}
    const bootstrapParam =
      typeof req.query.bootstrap === 'string'
        ? req.query.bootstrap
        : Array.isArray(req.query.bootstrap)
        ? req.query.bootstrap[0]
        : undefined
    const bootstrap = String(bootstrapParam ?? 'false').toLowerCase() === 'true'
    const url = `${baseUrl}/recalculate/${encodeURIComponent(req.params.id)}/pokemon?bootstrap=${bootstrap ? 'true' : 'false'}`
    const drRes = await fetch(url, { method: 'GET', headers })
    const text = await drRes.text().catch(() => '')
    if (!drRes.ok) return res.status(drRes.status).json({ status: 'error', reason: text || 'Dragonite recalc failed' })
    let data
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    res.status(200).json({ status: 'ok', data })
  } catch (e) {
    log.error(TAGS.api, req.originalUrl, e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// GET /api/v1/area/dragonite/reload -> forwards to Dragonite '/reload'
router.get('/dragonite/reload', async (req, res) => {
  try {
    const { baseUrl } = buildDragoniteHeaders()
    if (!baseUrl) return res.status(500).json({ status: 'error', reason: 'Dragonite baseUrl missing' })
    // Reload does not require auth; forward without auth/custom headers
    const drRes = await fetch(`${baseUrl}/reload`, { method: 'GET' })
    if (!drRes.ok) return res.status(drRes.status).json({ status: 'error', reason: 'Dragonite reload failed' })
    res.status(202).json({ status: 'ok' })
  } catch (e) {
    log.error(TAGS.api, req.originalUrl, e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// GET /api/v1/area/dragonite/status -> proxy Dragonite status
router.get('/dragonite/status', async (req, res) => {
  try {
    const { baseUrl, headers } = buildDragoniteHeaders()
    if (!baseUrl) return res.status(500).json({ status: 'error', reason: 'Dragonite baseUrl missing' })
    const drRes = await fetch(`${baseUrl}/status/`, { method: 'GET', headers })
    const text = await drRes.text().catch(() => '')
    if (!drRes.ok) return res.status(drRes.status).json({ status: 'error', reason: text || 'Dragonite status failed' })
    let data
    try { data = JSON.parse(text) } catch { data = { raw: text } }
    res.status(200).json(data)
  } catch (e) {
    log.error(TAGS.api, req.originalUrl, e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

// GET /api/v1/area/dragonite/route/:id -> return normalized route points for an area
router.get('/dragonite/route/:id', async (req, res) => {
  try {
    const { baseUrl, headers } = buildDragoniteHeaders()
    if (!baseUrl) return res.status(500).json({ status: 'error', reason: 'Dragonite baseUrl missing' })

    const targetId = String(req.params.id)
    
    // Helper utils
    const inRange = (lat, lon) =>
      typeof lat === 'number' && typeof lon === 'number' && lat <= 90 && lat >= -90 && lon <= 180 && lon >= -180
    const normalizeArray = (arr) => {
      /** @type {Array<{lat:number, lon:number}>} */
      const tmp = []
      if (!Array.isArray(arr)) return tmp
      for (const item of arr) {
        if (Array.isArray(item) && item.length >= 2) {
          const [a, b] = item
          if (inRange(a, b)) tmp.push({ lat: a, lon: b })
          else if (inRange(b, a)) tmp.push({ lat: b, lon: a })
        } else if (item && typeof item === 'object') {
          const lat = item.lat ?? item.latitude ?? item.lat_degrees
          const lon = item.lon ?? item.lng ?? item.lng_degrees ?? item.longitude
          if (inRange(lat, lon)) tmp.push({ lat, lon })
        }
      }
      return tmp
    }
    const scanObject = (node) => {
      /** @type {Array<{lat:number, lon:number}>} */
      let best = []
      const seen = new Set()
      const walk = (n) => {
        if (!n || typeof n !== 'object') return
        if (seen.has(n)) return
        seen.add(n)
        if (Array.isArray(n)) {
          const tmp = normalizeArray(n)
          if (tmp.length > best.length) best = tmp
          for (const el of n) walk(el)
          return
        }
        for (const k of Object.keys(n)) {
          const v = n[k]
          if (k === 'route_points' || k === 'route' || k === 'points' || k === 'waypoints' || k === 'path') {
            const tmp = normalizeArray(v)
            if (tmp.length > best.length) best = tmp
          }
          walk(v)
        }
      }
      walk(node)
      return best
    }

    // First: try Dragonite area detail (update area style)
    try {
      const detailRes = await fetch(`${baseUrl}/areas/${encodeURIComponent(targetId)}`, { method: 'GET', headers })
      const detailText = await detailRes.text().catch(() => '')
      if (detailRes.ok) {
        let detail
        try { detail = JSON.parse(detailText) } catch { detail = {} }
        // Common places where route might exist in area detail
        const candidatesDetail = [
          detail?.pokemon_mode?.route_points,
          detail?.pokemon_mode?.route,
          detail?.pokemon_mode?.points,
          detail?.pokemon_mode?.waypoints,
          detail?.pokemon_mode?.path,
          detail?.options?.pokemon_mode?.route_points,
          detail?.options?.pokemon_mode?.route,
          detail?.options?.pokemon_mode?.points,
          detail?.options?.pokemon_mode?.waypoints,
          detail?.options?.pokemon_mode?.path,
          detail?.route_points,
          detail?.route,
          detail?.points,
          detail?.waypoints,
          detail?.path,
        ].filter(Boolean)
        for (const arr of candidatesDetail) {
          const tmp = normalizeArray(arr)
          if (tmp.length) return res.status(200).json({ points: tmp })
        }
        // Fallback: deep scan detail for largest coordinate array
        const best = scanObject(detail)
        if (best.length) return res.status(200).json({ points: best })
      }
    } catch (_) {
      // ignore and fallback
    }

    // Fallback: Fetch Dragonite status payload and scan mode_status
    const drRes = await fetch(`${baseUrl}/status/`, { method: 'GET', headers })
    const text = await drRes.text().catch(() => '')
    if (!drRes.ok) return res.status(drRes.status).json({ status: 'error', reason: text || 'Dragonite status failed' })
    /** @type {any} */
    let status
    try { status = JSON.parse(text) } catch { status = {} }

    const areas = Array.isArray(status?.areas) ? status.areas : []
    const area = areas.find((a) => String(a?.id) === targetId)
    if (!area) {
      return res.status(404).json({ status: 'error', reason: 'Area not found', points: [] })
    }
    const wm = Array.isArray(area?.worker_managers) ? area.worker_managers : []
    let modeStatus = null
    for (const manager of wm) {
      const workers = Array.isArray(manager?.workers) ? manager.workers : []
      for (const w of workers) {
        if (w?.mode_status) { modeStatus = w.mode_status; break }
      }
      if (modeStatus) break
    }
    if (!modeStatus) {
      return res.status(200).json({ points: [] })
    }

    const candidates = [
      modeStatus?.route_points,
      modeStatus?.route,
      modeStatus?.points,
      modeStatus?.waypoints,
      modeStatus?.path,
    ].filter(Boolean)

    /** @type {Array<{lat:number, lon:number}>} */
    let points = []

    // First pass over common fields
    for (const arr of candidates) {
      const tmp = normalizeArray(arr)
      if (tmp.length) { points = tmp; break }
    }

    // Fallback: recursively scan mode_status for the biggest coordinate array
    if (!points.length) {
      const best = scanObject(modeStatus)
      if (best.length) points = best
    }

    return res.status(200).json({ points })
  } catch (e) {
    log.error(TAGS.api, req.originalUrl, e)
    res.status(500).json({ status: 'error', reason: e.message })
  }
})

module.exports = router
