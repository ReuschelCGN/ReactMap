// @ts-check
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Paper, Typography, Button, Box, Chip, Stack, Divider, useMediaQuery, Tooltip, IconButton } from '@mui/material'
import PolylineIcon from '@mui/icons-material/Polyline'
import DrawIcon from '@mui/icons-material/Draw'
import EditIcon from '@mui/icons-material/Edit'
import DeleteIcon from '@mui/icons-material/Delete'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft'
import ChevronRightIcon from '@mui/icons-material/ChevronRight'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import AltRouteIcon from '@mui/icons-material/AltRoute'
import PlaceIcon from '@mui/icons-material/Place'

import { useLayoutStore } from '@store/useLayoutStore'
import { WorkerManager } from './WorkerManager'
import { useStorage, useDeepStore } from '@store/useStorage'
import { useMemory } from '@store/useMemory'

export function FencePanel() {
  const { t } = useTranslation()
  const fenceOpen = useLayoutStore((s) => s.fence)
  const fenceAction = useLayoutStore((s) => s.fenceAction)
  const hasFenceEditorPerm = useMemory((s) => s.auth?.perms?.fenceEditor)
  const hasPublicFencesPerm = useMemory((s) => s.auth?.perms?.publicFences)
  const [fenceCount, setFenceCount] = React.useState(0)
  const [loading, setLoading] = React.useState(false)
  const [areaIdInput, setAreaIdInput] = React.useState(() => localStorage.getItem('dragoniteAreaId') || '')
  const [areaInfo, setAreaInfo] = React.useState(null)
  const [loadingInfo, setLoadingInfo] = React.useState(false)
  const [kojiGeofenceId, setKojiGeofenceId] = React.useState(null)
  const [focusedFence, setFocusedFence] = React.useState(null) // Currently focused fence from map
  const isMobile = useMediaQuery('(max-width:600px)')
  const [collapsed, setCollapsed] = React.useState(() => {
    try { return typeof window !== 'undefined' && window.innerWidth <= 600 } catch (_) { return false }
  }) // Panel collapsed state for mobile
  const [workerStats, setWorkerStats] = React.useState(null) // { total, allocated, available }
  const [contributorsInfo, setContributorsInfo] = React.useState({ count: 0, total: 0 })
  const spawnEnabled = useStorage((s) => !!s.filters?.spawnpoints?.enabled)
  const [unusedSpawnConfig, setSpawnConfig] = useDeepStore('filters.spawnpoints', {})
  const [blink, setBlink] = React.useState(false)
  const [wraps, setWraps] = React.useState(0)
  const speedRef = React.useRef({ lastPos: null, lastTs: 0, speed: 0 })
  const [etaSeconds, setEtaSeconds] = React.useState(null)
  const autoTriggeredRef = React.useRef(false)
  const [bootstrapPending, setBootstrapPending] = React.useState(false)
  const toggleSpawns = React.useCallback(() => {
    setSpawnConfig((prev) => {
      const base = prev && typeof prev === 'object' ? prev : {}
      return { ...base, enabled: !spawnEnabled }
    })
  }, [spawnEnabled, setSpawnConfig])

  // Listen for fence focus events from FenceDrawer (always on)
  React.useEffect(() => {
    const handleFenceFocused = (e) => {
      const fence = e.detail
      console.log('FencePanel: Fence focused:', fence)
      setFocusedFence(fence)
      // Load area info for this fence
      if (fence.dragoniteAreaId) {
        loadAreaInfo(String(fence.dragoniteAreaId))
        setKojiGeofenceId(fence.id)
      }
    }
    const handleAutoBootstrap = (e) => {
      const areaId = e?.detail?.dragoniteAreaId
      if (areaId) {
        setAreaIdInput(String(areaId))
        loadAreaInfo(String(areaId))
        setBootstrapPending(true)
        // Resolve Koji fence id so we can blink even without focus
        loadKojiGeofenceId(String(areaId))
        try {
          if (focusedFence && focusedFence.dragoniteAreaId == areaId && focusedFence.id) {
            window.dispatchEvent(new CustomEvent('startFenceBlink', { detail: { fenceId: focusedFence.id } }))
          }
        } catch (_) {}
      }
    }
    window.addEventListener('fenceFocused', handleFenceFocused)
    window.addEventListener('autoBootstrapStarted', handleAutoBootstrap)
    return () => {
      window.removeEventListener('fenceFocused', handleFenceFocused)
      window.removeEventListener('autoBootstrapStarted', handleAutoBootstrap)
    }
  }, [])

  React.useEffect(() => {
    if (fenceOpen) {
      const fences = JSON.parse(localStorage.getItem('userFences') || '[]')
      setFenceCount(fences.length)
      
      // Lade Dragonite Area Info und Koji Geofence ID nur wenn keine Fence fokussiert ist
      if (!focusedFence) {
        const areaId = localStorage.getItem('dragoniteAreaId')
        if (areaId) {
          loadAreaInfo(areaId)
          loadKojiGeofenceId(areaId)
        } else {
          setAreaInfo(null)
        }
      }
    } else {
      // Fence-Modus geschlossen -> Clear Area Info
      setAreaInfo(null)
      setFocusedFence(null)
      setWraps(0)
      setEtaSeconds(null)
      speedRef.current = { lastPos: null, lastTs: 0, speed: 0 }
    }
  }, [fenceOpen, focusedFence])
  
  // Auto-refresh area info for focused fence
  React.useEffect(() => {
    if (!fenceOpen || !focusedFence?.dragoniteAreaId) return
    
    const interval = setInterval(() => {
      if (focusedFence?.dragoniteAreaId) {
        loadAreaInfo(String(focusedFence.dragoniteAreaId))
      }
    }, 5000)
    
    return () => clearInterval(interval)
  }, [fenceOpen, focusedFence?.dragoniteAreaId])

  
  
  // CRITICAL: Listen for storage changes to detect fence deletion
  React.useEffect(() => {
    if (!fenceOpen) return
    
    const handleStorageChange = (e) => {
      // Check if dragoniteAreaId was removed
      if (e.key === 'dragoniteAreaId' && !e.newValue) {
        console.log('FencePanel: dragoniteAreaId removed, clearing area info')
        // Only clear if no focused fence provides an area id
        if (!focusedFence?.dragoniteAreaId) {
          setAreaInfo(null)
          setAreaIdInput('')
        }
      }
      // Check if userFences was removed
      if (e.key === 'userFences') {
        const fences = JSON.parse(e.newValue || '[]')
        setFenceCount(fences.length)
      }
    }
    
    // Also poll localStorage periodically as storage events don't fire in same tab
    const pollInterval = setInterval(() => {
      const areaId = localStorage.getItem('dragoniteAreaId')
      if (!areaId && areaInfo && !focusedFence?.dragoniteAreaId) {
        console.log('FencePanel: Detected dragoniteAreaId removal via polling')
        setAreaInfo(null)
        setAreaIdInput('')
      }
    }, 100) // Poll every 100ms for faster response
    
    window.addEventListener('storage', handleStorageChange)
    return () => {
      window.removeEventListener('storage', handleStorageChange)
      clearInterval(pollInterval)
    }
  }, [fenceOpen, areaInfo])

  // Load my worker stats and current fence contributors when a fence is focused
  React.useEffect(() => {
    if (!fenceOpen || !focusedFence) return
    const fenceId = kojiGeofenceId || focusedFence.id
    ;(async () => {
      try {
        // My worker stats
        const statsRes = await fetch('/api/v1/users/me/workers', { credentials: 'same-origin' })
        if (statsRes.ok) {
          const s = await statsRes.json()
          setWorkerStats(s || null)
        }
      } catch (_) {}
      try {
        if (!fenceId) return
        const cRes = await fetch(`/api/v1/users/fence/${fenceId}/contributors`, { credentials: 'same-origin' })
        if (cRes.ok) {
          const d = await cRes.json().catch(() => ({}))
          const list = Array.isArray(d?.contributors) ? d.contributors : []
          const total = list.reduce((sum, c) => sum + (c?.workers || 0), 0)
          setContributorsInfo({ count: list.length, total })
        }
      } catch (_) {}
    })()
  }, [fenceOpen, focusedFence?.id, kojiGeofenceId])

  const loadAreaInfo = async (areaId) => {
    if (!areaId) return
    try {
      setLoadingInfo(true)
      const res = await fetch('/api/v1/area/dragonite/status', { credentials: 'same-origin' })
      if (res.ok) {
        const data = await res.json()
        const area = data.areas?.find(a => a.id === parseInt(areaId))
        setAreaInfo(area || null)
      }
    } catch (e) {
      console.warn('Failed to load area info', e)
    } finally {
      setLoadingInfo(false)
    }
  }

  // (moved below triggerDragonite)

  const loadKojiGeofenceId = async (dragoniteAreaId) => {
    if (!dragoniteAreaId) return
    try {
      // Suche in allen Fences nach der mit dieser Dragonite Area ID
      const res = await fetch('/api/v1/users/fences/public', { credentials: 'same-origin' })
      if (res.ok) {
        const fences = await res.json()
        const fence = fences.find(f => f.dragoniteAreaId === parseInt(dragoniteAreaId))
        if (fence) {
          setKojiGeofenceId(fence.id)
          console.log('FencePanel: Found Koji geofence ID', fence.id, 'for Dragonite area', dragoniteAreaId)
        }
      }
    } catch (e) {
      console.warn('Failed to load Koji geofence ID', e)
    }
  }

  // Extract clean fence name from Dragonite area name
  // Format: userId_timestamp_name -> name
  const getCleanFenceName = (dragoniteAreaName) => {
    if (!dragoniteAreaName) return ''
    
    // Split by underscore
    const parts = dragoniteAreaName.split('_')
    
    // If format is userId_timestamp_name, return name (last part)
    if (parts.length >= 3) {
      // Join all parts after the first two (in case name contains underscores)
      return parts.slice(2).join('_')
    }
    
    // Fallback: return full name
    return dragoniteAreaName
  }

  // Berechne Routenlänge und Position aus Area Info
  const getRouteInfo = () => {
    if (!areaInfo?.worker_managers?.[0]?.workers?.[0]?.mode_status) return { length: null, position: null, mode: null }
    const modeStatus = areaInfo.worker_managers[0].workers[0].mode_status
    return {
      length: modeStatus.total_route_points || null,
      position: modeStatus.route_pos !== undefined ? modeStatus.route_pos : null,
      mode: modeStatus.mode || null
    }
  }

  // CRITICAL: Safety check - if areaInfo exists but no dragoniteAreaId in localStorage or focus, clear it
  React.useEffect(() => {
    if (areaInfo && !localStorage.getItem('dragoniteAreaId') && !focusedFence?.dragoniteAreaId) {
      console.log('FencePanel: Safety check - clearing orphaned areaInfo')
      setAreaInfo(null)
      setAreaIdInput('')
    }
  }, [areaInfo, focusedFence?.dragoniteAreaId])

  const routeInfo = getRouteInfo()
  const routeLength = routeInfo.length
  const routePosition = routeInfo.position
  const currentMode = routeInfo.mode
  const activeWorkers = areaInfo?.worker_managers?.[0]?.active_workers || 0
  const positionsPerWorker = activeWorkers ? Math.round(routeLength / activeWorkers) : null
  const isRouteTooLong = positionsPerWorker && positionsPerWorker > 100
  
  // Prüfe ob Spawns erkundet werden (bootstrap mode)
  const isExploringSpawns = currentMode === 'bootstrap'
  const exploring = isExploringSpawns || bootstrapPending
  // Prüfe ob Route existiert (spawns sind bekannt)
  const hasRoute = routeLength && routeLength > 0

  const onAreaIdChange = (val) => {
    const trimmed = String(val || '').trim()
    setAreaIdInput(trimmed)
    if (!trimmed) {
      localStorage.removeItem('dragoniteAreaId')
    } else {
      localStorage.setItem('dragoniteAreaId', trimmed)
    }
  }

  const triggerDragonite = async (bootstrap) => {
    // Use focused fence's dragoniteAreaId
    const areaId = focusedFence?.dragoniteAreaId
    if (!areaId) {
      alert(t('no_area_selected', 'Keine Fence ausgewählt. Klicke auf eine Fence auf der Karte.'))
      return
    }
    try {
      setLoading(true)
      console.log('FencePanel: Triggering Dragonite for area', areaId, 'bootstrap:', bootstrap)
      await fetch(`/api/v1/area/dragonite/recalculate/${encodeURIComponent(areaId)}?bootstrap=${bootstrap ? 'true' : 'false'}`)
      await fetch('/api/v1/area/dragonite/reload')
      
      // Reload area info after trigger
      setTimeout(() => {
        if (focusedFence?.dragoniteAreaId) {
          loadAreaInfo(String(focusedFence.dragoniteAreaId))
        }
      }, 1000)
    } catch (e) {
      console.error('FencePanel: Dragonite trigger failed', e)
    } finally {
      setLoading(false)
    }
  }

  // When real bootstrap starts, drop the pending flag
  React.useEffect(() => {
    if (isExploringSpawns && bootstrapPending) setBootstrapPending(false)
  }, [isExploringSpawns, bootstrapPending])

  // Blink panel + map fence while exploring spawns
  React.useEffect(() => {
    if (!fenceOpen) return
    let t = null
    if (exploring) {
      t = setInterval(() => setBlink((b) => !b), 800)
      try {
        const fenceId = (focusedFence && focusedFence.id) || kojiGeofenceId
        if (fenceId) window.dispatchEvent(new CustomEvent('startFenceBlink', { detail: { fenceId } }))
      } catch (_) {}
    } else {
      setBlink(false)
      try {
        const fenceId = (focusedFence && focusedFence.id) || kojiGeofenceId
        if (fenceId) window.dispatchEvent(new CustomEvent('stopFenceBlink', { detail: { fenceId } }))
      } catch (_) {}
    }
    return () => { if (t) clearInterval(t) }
  }, [fenceOpen, exploring, focusedFence?.id, kojiGeofenceId])

  // Reset auto-trigger guard when (re)entering bootstrap
  React.useEffect(() => {
    if (exploring) {
      autoTriggeredRef.current = false
    }
  }, [exploring])

  // Track progress and compute ETA; detect wraparounds to count passes
  React.useEffect(() => {
    if (!fenceOpen || !exploring) return
    const pos = routePosition || 0
    const len = routeLength || 0
    const now = Date.now()
    const prev = speedRef.current
    if (len > 0) {
      if (prev.lastPos !== null) {
        if (pos < prev.lastPos - 5) setWraps((w) => w + 1)
        const dPos = pos >= prev.lastPos ? pos - prev.lastPos : (len - prev.lastPos) + pos
        const dt = (now - prev.lastTs) / 1000
        if (dt > 0 && dPos >= 0) {
          const inst = dPos / dt
          const smooth = prev.speed ? prev.speed * 0.7 + inst * 0.3 : inst
          speedRef.current = { lastPos: pos, lastTs: now, speed: smooth }
          const remainingCurrent = Math.max(0, len - pos)
          const remainingTotal = wraps === 0 ? remainingCurrent + len : remainingCurrent
          const eta = smooth > 0 ? Math.round(remainingTotal / smooth) : null
          setEtaSeconds(eta)
        } else {
          speedRef.current = { lastPos: pos, lastTs: now, speed: prev.speed || 0 }
        }
      } else {
        speedRef.current = { lastPos: pos, lastTs: now, speed: 0 }
      }
    } else {
      setEtaSeconds(null)
    }
  }, [fenceOpen, exploring, routePosition, routeLength, wraps])

  // After two passes, trigger normal route build automatically (one-shot)
  React.useEffect(() => {
    if (!fenceOpen || !exploring) return
    if (wraps >= 2 && !autoTriggeredRef.current) {
      autoTriggeredRef.current = true
      triggerDragonite(false)
      setWraps(0)
      setEtaSeconds(null)
      speedRef.current = { lastPos: null, lastTs: 0, speed: 0 }
      try {
        const fenceId = (focusedFence && focusedFence.id) || kojiGeofenceId
        if (fenceId) window.dispatchEvent(new CustomEvent('stopFenceBlink', { detail: { fenceId } }))
      } catch (_) {}
    }
  }, [fenceOpen, exploring, wraps, focusedFence?.id, kojiGeofenceId])

  // Worker +/- for focused fence (same API as WorkerManager)
  const adjustWorkers = async (delta) => {
    const fenceId = kojiGeofenceId || focusedFence?.id
    if (!fenceId) return
    try {
      setLoading(true)
      const res = await fetch(`/api/v1/users/fence/${fenceId}/workers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ workerDelta: delta })
      })
      if (!res.ok) {
        let msg = 'Fehler beim Zuweisen der Worker'
        try { const j = await res.json(); if (j?.reason) msg = j.reason } catch (_) {}
        try { alert(msg) } catch (_) {}
      }
    } catch (e) {
      console.error('adjustWorkers failed', e)
    } finally {
      setLoading(false)
    }
  }

  if (!fenceOpen) return null

  return (
    <React.Fragment>
    {!isMobile && (
    <Box
      sx={{
        position: 'fixed',
        top: 80,
        right: collapsed ? -280 : 10,
        zIndex: 1000,
        minWidth: 280,
        maxWidth: 320,
        transition: 'right 0.3s ease-in-out',
        // Mobile responsive
        '@media (max-width: 600px)': {
          top: 60,
          right: collapsed ? -260 : 0,
          minWidth: 260,
          maxWidth: 280,
        },
      }}
    >
      <Paper
        elevation={8}
        sx={{
          p: 2,
          background: isRouteTooLong 
            ? 'linear-gradient(135deg, rgba(255, 152, 0, 0.15) 0%, rgba(255, 193, 7, 0.08) 100%)'
            : 'linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(250, 250, 255, 0.98) 100%)',
          backdropFilter: 'blur(12px)',
          borderRadius: 2,
          border: isRouteTooLong 
            ? '2px solid rgba(255, 152, 0, 0.5)'
            : '1px solid rgba(51, 136, 255, 0.15)',
          position: 'relative',
          '@media (max-width: 600px)': {
            p: 1.25,
            borderRadius: 0,
            maxHeight: 'calc(100vh - 60px)',
            overflowY: 'auto',
          },
        }}
      >
        {/* Toggle Button - nur auf Mobile sichtbar */}
        <Box
          sx={{
            display: 'none',
            '@media (max-width: 600px)': {
              display: 'block',
              position: 'absolute',
              left: -40,
              top: '50%',
              transform: 'translateY(-50%)',
              zIndex: 1001,
            },
          }}
        >
          <Button
            variant="contained"
            color="primary"
            onClick={() => setCollapsed(!collapsed)}
            sx={{
              minWidth: 40,
              width: 40,
              height: 60,
              borderRadius: '8px 0 0 8px',
              p: 0,
              boxShadow: 3,
            }}
          >
            {collapsed ? <ChevronLeftIcon /> : <ChevronRightIcon />}
          </Button>
        </Box>
        <Stack spacing={1.5}>
          {/* Header */}
          <Box display="flex" alignItems="center" justifyContent="space-between">
            <Typography variant="h6" component="h3" sx={{ fontWeight: 700, fontSize: '1.1rem', color: '#1976d2' }}>
              🗺️ {t('fence_editor', 'Fence Editor')}
            </Typography>
            <Chip
              label={t('active', 'Active')}
              color="success"
              size="small"
              sx={{ fontWeight: 600 }}
            />
          </Box>

          {/* Tools */}
          <Box sx={{ 
            p: 1.5, 
            backgroundColor: 'rgba(25, 118, 210, 0.05)', 
            borderRadius: 1.5,
            border: '1px solid rgba(25, 118, 210, 0.15)'
          }}>
            <Stack spacing={1}>
              <Button
                size="small"
                variant="contained"
                color="primary"
                startIcon={<PolylineIcon />}
                onClick={() => useLayoutStore.setState({ fenceAction: 'draw' })}
                fullWidth
                sx={{ textTransform: 'none', fontWeight: 600, '@media (max-width: 600px)': { justifyContent: 'center' } }}
              >
                <Box sx={{ display: { xs: 'none', sm: 'inline' } }}>{t('draw', 'Zeichnen')}</Box>
              </Button>

              {/* Spawn positions toggle (desktop) */}
              <Button
                size="small"
                variant={spawnEnabled ? 'contained' : 'outlined'}
                color={spawnEnabled ? 'secondary' : 'primary'}
                startIcon={<PlaceIcon />}
                onClick={toggleSpawns}
                fullWidth
                sx={{ textTransform: 'none', '@media (max-width: 600px)': { justifyContent: 'center' } }}
              >
                <Box sx={{ display: { xs: 'none', sm: 'inline' } }}>
                  {spawnEnabled ? t('hide_spawn_positions', 'Spawns ausblenden') : t('show_spawn_positions', 'Spawns anzeigen')}
                </Box>
              </Button>
              
              {/* Bearbeiten Button - nur wenn Fence fokussiert ist */}
              {focusedFence && (
                <Button
                  size="small"
                  variant={fenceAction === 'edit' ? 'contained' : 'outlined'}
                  color={fenceAction === 'edit' ? 'warning' : 'primary'}
                  startIcon={<EditIcon />}
                  onClick={() => {
                    console.log('FencePanel: Edit button clicked, current fenceAction:', fenceAction)
                    if (fenceAction === 'edit') {
                      // Beenden des Edit-Modus ohne Speichern
                      console.log('FencePanel: Exiting edit mode')
                      useLayoutStore.setState({ fenceAction: 'cancel' })
                    } else {
                      // Starten des Edit-Modus
                      console.log('FencePanel: Entering edit mode')
                      useLayoutStore.setState({ fenceAction: 'edit' })
                    }
                  }}
                  fullWidth
                  sx={{ textTransform: 'none', fontWeight: fenceAction === 'edit' ? 600 : 400, '@media (max-width: 600px)': { justifyContent: 'center' } }}
                >
                  <Box sx={{ display: { xs: 'none', sm: 'inline' } }}>{fenceAction === 'edit' ? `❌ ${t('cancel', 'Abbrechen')}` : t('edit', 'Bearbeiten')}</Box>
                </Button>
              )}
              
              {/* Speichern Button - nur im Edit-Modus sichtbar */}
              {(() => {
                console.log('FencePanel: Checking save button visibility - focusedFence:', !!focusedFence, 'fenceAction:', fenceAction)
                return focusedFence && fenceAction === 'edit' && (
                  <Button
                    size="small"
                    variant="contained"
                    color="success"
                    startIcon={<DrawIcon />}
                    onClick={() => {
                      console.log('FencePanel: Save button clicked for fence:', focusedFence)
                      // Trigger save by dispatching a custom event
                      window.dispatchEvent(new CustomEvent('saveFenceEdit', { detail: focusedFence }))
                      // Exit edit mode
                      useLayoutStore.setState({ fenceAction: '' })
                    }}
                    fullWidth
                    sx={{ textTransform: 'none', fontWeight: 600, '@media (max-width: 600px)': { justifyContent: 'center' } }}
                  >
                    <Box sx={{ display: { xs: 'none', sm: 'inline' } }}>{t('save_changes', '💾 Übernehmen')}</Box>
                  </Button>
                )
              })()}
              
              {/* Löschen Button - nur wenn Fence fokussiert ist */}
              {focusedFence && (
                <Button
                  size="small"
                  variant="contained"
                  color="error"
                  startIcon={<DeleteIcon />}
                  onClick={async () => {
                    const fenceName = focusedFence.name || 'diese Fence'
                    const ok = window.confirm(`"${fenceName}" wirklich löschen? (wird auch in Dragonite entfernt)`)
                    if (!ok) return
                    try {
                      // Delete specific fence by ID
                      const res = await fetch(`/api/v1/users/geofence/${focusedFence.id}`, { 
                        method: 'DELETE', 
                        credentials: 'same-origin' 
                      })
                      
                      if (res.ok || res.status === 207) {
                        const data = await res.json()
                        console.log('FencePanel: Fence deleted', data)
                        
                        // Clear focused fence
                        setFocusedFence(null)
                        setAreaInfo(null)
                        setKojiGeofenceId(null)
                        
                        // Trigger FenceDrawer to reload fences
                        window.dispatchEvent(new CustomEvent('fenceDeleted'))
                        
                        // Reload areas
                        await fetch('/api/v1/area/reload', { method: 'GET', credentials: 'same-origin' })
                        
                        // Show appropriate message
                        if (data.status === 'partial') {
                          alert(`"${fenceName}" wurde aus der Karte gelöscht.\n\nWARNUNG: ${data.message || 'Dragonite-Synchronisation fehlgeschlagen'}\n\nBitte prüfe Dragonite manuell.`)
                        } else {
                          alert(`"${fenceName}" erfolgreich gelöscht!`)
                        }
                      } else {
                        // Handle error response
                        let errorMsg = 'Fehler beim Löschen der Fence'
                        try {
                          const errorData = await res.json()
                          if (errorData.reason) {
                            errorMsg = errorData.reason
                          }
                        } catch (_) {
                          // Fallback to status text
                          errorMsg = `Fehler ${res.status}: ${res.statusText}`
                        }
                        alert(errorMsg)
                      }
                    } catch (e) {
                      console.error('FencePanel: Delete failed', e)
                      alert('Fehler beim Löschen der Fence: ' + e.message)
                    }
                  }}
                  fullWidth
                  sx={{ textTransform: 'none', fontWeight: 600, '@media (max-width: 600px)': { justifyContent: 'center' } }}
                >
                  <Box sx={{ display: { xs: 'none', sm: 'inline' } }}>🗑️ {t('delete_named', '{{name}} Delete').replace('{{name}}', focusedFence.name)}</Box>
                </Button>
              )}
            </Stack>
          </Box>

          <Divider sx={{ my: 0.5 }} />

          {/* Dragonite Area */}
          <Box>
            {/* Area Info */}
            {areaInfo && (
              <Box sx={{ 
                p: 1.2, 
                mb: 1,
                background: areaInfo.enabled 
                  ? 'linear-gradient(135deg, rgba(76, 175, 80, 0.08) 0%, rgba(76, 175, 80, 0.03) 100%)' 
                  : 'linear-gradient(135deg, rgba(158, 158, 158, 0.08) 0%, rgba(158, 158, 158, 0.03) 100%)',
                borderRadius: 1.5, 
                border: areaInfo.enabled ? '1px solid rgba(76, 175, 80, 0.25)' : '1px solid rgba(158, 158, 158, 0.25)'
              }}>
                <Stack spacing={0.3}>
                  <Typography variant="body2" sx={{ fontWeight: 700, color: '#000', fontSize: '0.85rem' }}>
                    🎯 {getCleanFenceName(areaInfo.name)}
                  </Typography>
                  <Box display="flex" gap={1.5} flexWrap="wrap">
                    <Typography variant="caption" sx={{ color: '#333', fontSize: '0.7rem' }}>
                      {areaInfo.enabled ? `✅ ${t('active', 'Active')}` : `❌ ${t('inactive', 'Inactive')}`}
                    </Typography>
                    {areaInfo.worker_managers?.[0] && (
                      <Typography variant="caption" sx={{ color: '#333', fontSize: '0.7rem' }}>
                        👷 {areaInfo.worker_managers[0].active_workers}/{areaInfo.worker_managers[0].expected_workers}
                      </Typography>
                    )}
                  </Box>
                  {routeLength && (
                    (() => {
                      const wm = areaInfo.worker_managers?.[0]
                      const active = wm?.active_workers || 0
                      if (!active || !routeLength) return null
                      const perWorker = Math.round(routeLength / active)
                      let qualityKey = 'quality_ok'
                      let qualityColor = '#f57c00'
                      if (perWorker < 100) { qualityKey = 'quality_top'; qualityColor = '#2e7d32' }
                      else if (perWorker > 150) { qualityKey = 'quality_bad'; qualityColor = '#d32f2f' }
                      return (
                        <Box display="flex" gap={1.5} flexWrap="wrap" sx={{ mt: 0.3 }}>
                          <Typography variant="caption" sx={{ color: '#333', fontSize: '0.7rem' }}>
                            📍 {t('positions_per_worker', 'Positionen pro Worker')}: {perWorker}
                          </Typography>
                          <Typography variant="caption" sx={{ color: qualityColor, fontSize: '0.7rem', fontWeight: 700 }}>
                            ⭐ {t('quality_label', 'Qualität')}: {t(qualityKey, qualityKey)}
                          </Typography>
                        </Box>
                      )
                    })()
                  )}
                </Stack>
              </Box>
            )}

            {/* Hinweise und Warnungen */}
            {!hasRoute && !isExploringSpawns && (
              <Box sx={{ 
                p: 1, 
                mb: 1,
                backgroundColor: 'rgba(33, 150, 243, 0.1)',
                borderRadius: 1,
                border: '1px solid rgba(33, 150, 243, 0.3)'
              }}>
                <Typography variant="caption" sx={{ color: '#1565c0', fontWeight: 600, fontSize: '0.7rem' }}>
                  ℹ️ {t('hint_explore_first', 'Zuerst Spawns erkunden, dann Route erstellen!')}
                </Typography>
              </Box>
            )}

            {exploring && (
              <Box sx={{ 
                p: 1, 
                mb: 1,
                backgroundColor: blink ? 'rgba(255, 193, 7, 0.22)' : 'rgba(255, 193, 7, 0.1)',
                borderRadius: 1,
                border: '1px solid rgba(255, 193, 7, 0.3)'
              }}>
                <Typography variant="caption" sx={{ color: '#f57c00', fontWeight: 600, fontSize: '0.7rem' }}>
                  🔄 {t('exploring_spawns', 'Spawns werden erkundet...')}
                </Typography>
                {routeLength && (
                  <Box sx={{ mt: 0.5 }}>
                    <Typography variant="caption" sx={{ color: '#8d6e63', fontSize: '0.7rem' }}>
                      {`Fortschritt: ${routePosition || 0}/${routeLength} • Durchläufe: ${wraps}/2`}
                    </Typography>
                    {etaSeconds !== null && (
                      <Typography variant="caption" sx={{ display: 'block', color: '#6d4c41', fontSize: '0.7rem' }}>
                        {`ETA: ${Math.max(1, Math.round(etaSeconds / 60))} min`}
                      </Typography>
                    )}
                  </Box>
                )}
              </Box>
            )}

            {isRouteTooLong && (
              <Box sx={{ 
                p: 1, 
                mb: 1,
                backgroundColor: 'rgba(255, 152, 0, 0.1)',
                borderRadius: 1,
                border: '1px solid rgba(255, 152, 0, 0.3)'
              }}>
                <Typography variant="caption" sx={{ color: '#e65100', fontWeight: 600, fontSize: '0.7rem' }}>
                  ⚠️ {t('warn_route_too_long', 'Route über 100 Positionen - Scan-Qualität kann leiden!')}
                </Typography>
              </Box>
            )}

            <Stack spacing={0.8}>
              <Button
                size="small"
                variant="contained"
                color="secondary"
                disabled={!focusedFence || loading || isExploringSpawns}
                onClick={() => triggerDragonite(true)}
                fullWidth
                sx={{ textTransform: 'none', py: 0.8, '@media (max-width: 600px)': { justifyContent: 'center' } }}
              >
                <Box sx={{ display: { xs: 'none', sm: 'inline' } }}>🔍 {t('explore_spawns', 'Spawns erkunden')}</Box>
              </Button>
              <Button
                size="small"
                variant="contained"
                color="primary"
                disabled={!focusedFence || loading}
                onClick={() => triggerDragonite(false)}
                fullWidth
                sx={{ textTransform: 'none', py: 0.8, '@media (max-width: 600px)': { justifyContent: 'center' } }}
              >
                <Box sx={{ display: { xs: 'none', sm: 'inline' } }}>🚀 {t('build_route', 'Route erstellen')}</Box>
              </Button>
            </Stack>
            
            {/* Hinweis wenn keine Fence fokussiert */}
            {!focusedFence && (
              <Box sx={{ 
                p: 1, 
                mt: 1,
                backgroundColor: 'rgba(33, 150, 243, 0.1)',
                borderRadius: 1,
                border: '1px solid rgba(33, 150, 243, 0.3)'
              }}>
                <Typography variant="caption" sx={{ color: '#1565c0', fontWeight: 600, fontSize: '0.7rem' }}>
                  👆 {t('click_to_manage_fence', 'Klicke auf eine Fence auf der Karte um sie zu verwalten')}
                </Typography>
              </Box>
            )}
          </Box>

          <Divider sx={{ my: 2 }} />

          {/* Worker Management */}
          {kojiGeofenceId && (
            <WorkerManager 
              fenceId={kojiGeofenceId}
              fenceName={
                getCleanFenceName(areaInfo?.name) 
                || getCleanFenceName(focusedFence?.name) 
                || 'Meine Fence'
              }
              isOwner={true}
            />
          )}

          <Button
            variant="outlined"
            color="error"
            onClick={() => useLayoutStore.setState({ fence: false })}
            fullWidth
            sx={{ textTransform: 'none', fontWeight: 600, mt: 2, '@media (max-width: 600px)': { justifyContent: 'center' } }}
          >
            <Box sx={{ display: { xs: 'none', sm: 'inline' } }}>❌ {t('close', 'Schließen')}</Box>
          </Button>
        </Stack>
      </Paper>
    </Box>
    )}
    {isMobile && fenceOpen && (
      <Box
        sx={{
          position: 'fixed',
          right: 6,
          top: '50%',
          transform: 'translateY(-50%)',
          zIndex: 1001,
        }}
      >
        <Paper elevation={6} sx={{ p: 0.5, borderRadius: 2 }}>
          <Stack spacing={0.5} alignItems="center">
            <Tooltip title={t('draw', 'Zeichnen')} placement="left">
              <span>
                <IconButton color="primary" size="small" onClick={() => useLayoutStore.setState({ fenceAction: 'draw' })}>
                  <PolylineIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            {/* Spawn positions toggle (mobile) */}
            <Tooltip title={spawnEnabled ? t('hide_spawn_positions', 'Spawns ausblenden') : t('show_spawn_positions', 'Spawns anzeigen')} placement="left">
              <span>
                <IconButton color={spawnEnabled ? 'secondary' : 'default'} size="small" onClick={toggleSpawns}>
                  <PlaceIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            {focusedFence && (
              <Tooltip title={fenceAction === 'edit' ? t('cancel', 'Abbrechen') : t('edit', 'Bearbeiten')} placement="left">
                <span>
                  <IconButton
                    color={fenceAction === 'edit' ? 'warning' : 'primary'}
                    size="small"
                    onClick={() => useLayoutStore.setState({ fenceAction: fenceAction === 'edit' ? 'cancel' : 'edit' })}
                  >
                    <EditIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {focusedFence && fenceAction === 'edit' && (
              <Tooltip title={t('save', 'Speichern')} placement="left">
                <span>
                  <IconButton
                    color="success"
                    size="small"
                    onClick={() => {
                      window.dispatchEvent(new CustomEvent('saveFenceEdit', { detail: focusedFence }))
                      useLayoutStore.setState({ fenceAction: '' })
                    }}
                  >
                    <DrawIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {focusedFence && (
              <Tooltip title={t('worker_minus', 'Worker entfernen') } placement="left">
                <span>
                  <IconButton color="error" size="small" onClick={() => adjustWorkers(-1)} disabled={loading}>
                    <RemoveIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            {focusedFence && (
              <Tooltip title={t('worker_plus', 'Worker hinzufügen') } placement="left">
                <span>
                  <IconButton color="success" size="small" onClick={() => adjustWorkers(1)} disabled={loading}>
                    <AddIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
            <Tooltip title={t('explore_spawns', 'Spawns erkunden')} placement="left">
              <span>
                <IconButton color="secondary" size="small" disabled={!focusedFence || loading || isExploringSpawns} onClick={() => triggerDragonite(true)}>
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={t('build_route', 'Route erstellen')} placement="left">
              <span>
                <IconButton color="primary" size="small" disabled={!focusedFence || loading} onClick={() => triggerDragonite(false)}>
                  <AltRouteIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            {focusedFence && (
              <Tooltip title={t('delete', 'Löschen')} placement="left">
                <span>
                  <IconButton
                    color="error"
                    size="small"
                    onClick={async () => {
                      const fenceName = focusedFence.name || 'diese Fence'
                      const ok = window.confirm(`"${fenceName}" wirklich löschen? (wird auch in Dragonite entfernt)`)
                      if (!ok) return
                      try {
                        const res = await fetch(`/api/v1/users/geofence/${focusedFence.id}`, { method: 'DELETE', credentials: 'same-origin' })
                        if (res.ok || res.status === 207) {
                          const data = await res.json()
                          setFocusedFence(null)
                          setAreaInfo(null)
                          setKojiGeofenceId(null)
                          window.dispatchEvent(new CustomEvent('fenceDeleted'))
                          await fetch('/api/v1/area/reload', { method: 'GET', credentials: 'same-origin' })
                          if (data.status === 'partial') {
                            alert(`"${fenceName}" wurde aus der Karte gelöscht.\n\nWARNUNG: ${data.message || 'Dragonite-Synchronisation fehlgeschlagen'}\n\nBitte prüfe Dragonite manuell.`)
                          } else {
                            alert(`"${fenceName}" erfolgreich gelöscht!`)
                          }
                        } else {
                          let errorMsg = 'Fehler beim Löschen der Fence'
                          try {
                            const errorData = await res.json()
                            if (errorData.reason) errorMsg = errorData.reason
                          } catch (_) {
                            errorMsg = `Fehler ${res.status}: ${res.statusText}`
                          }
                          alert(errorMsg)
                        }
                      } catch (e) {
                        alert('Fehler beim Löschen der Fence: ' + e.message)
                      }
                    }}
                  >
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            )}
          </Stack>
        </Paper>
      </Box>
    )}
    {isMobile && fenceOpen && focusedFence && (
      <Box
        sx={{
          position: 'fixed',
          right: 8,
          top: 8,
          zIndex: 1002,
          color: '#fff',
          textShadow: '0 1px 2px rgba(0,0,0,0.8)',
          fontSize: '11px',
          lineHeight: 1.3,
          px: 0.5,
          py: 0.25,
          background: 'transparent',
          pointerEvents: 'none',
          maxWidth: '75vw',
        }}
      >
        <div>
          <div>🎯 {(areaInfo && (getCleanFenceName(areaInfo.name) || '')) || (focusedFence && focusedFence.name) || 'Fence'}</div>
          <div>{areaInfo ? (areaInfo.enabled ? '✅ Dragonite: Active' : '❌ Dragonite: Inactive') : '⏳ Dragonite: ...'}</div>
          <div>👤 Owner: {focusedFence?.owner || 'unbekannt'}</div>
          <div>
            👤 Meine: {workerStats ? `${workerStats.allocated}/${workerStats.total} (frei ${workerStats.available})` : '...'}
          </div>
          <div>
            👥 Mitwirkende: {contributorsInfo?.count || 0}{contributorsInfo?.total ? `, Worker ${contributorsInfo.total}` : ''}
          </div>
          {areaInfo?.worker_managers?.[0] && (
            <div>👷 Worker: {areaInfo.worker_managers[0].active_workers}/{areaInfo.worker_managers[0].expected_workers}</div>
          )}
          {routeLength ? (
            <div>📍 {t('routes', 'Routes')}: {routePosition !== null ? `${routePosition}/${routeLength}` : routeLength}</div>
          ) : null}
          <div>✏️ {t('edit', 'Edit')}: {fenceAction === 'edit' ? t('on', 'on') : t('off', 'off')}</div>
        </div>
      </Box>
    )}
    </React.Fragment>
  )
}
