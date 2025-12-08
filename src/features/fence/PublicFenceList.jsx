// @ts-check
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { 
  Box, 
  Typography, 
  List,
  ListItem,
  ListItemButton,
  ListItemText,
  Chip,
  Stack,
  CircularProgress,
  Alert,
  Paper,
  IconButton,
  Collapse,
  Divider
} from '@mui/material'
import MapIcon from '@mui/icons-material/Map'
import PeopleIcon from '@mui/icons-material/People'
import WorkIcon from '@mui/icons-material/Work'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import L from 'leaflet'

/**
 * @typedef {Object} PublicFence
 * @property {number} id
 * @property {string} name
 * @property {string} mode
 * @property {string} owner
 * @property {string} [ownerName]
 * @property {number} totalWorkers
 * @property {string} lastActivity
 * @property {number|null} dragoniteAreaId
 * @property {number} contributorCount
 * @property {any} geometry
 * @property {number|null} [distanceKm] - Distance in kilometers (optional)
 */

/**
 * Public Fence List Component
 * Shows all available fences with worker info
 */
export function PublicFenceList() {
  const { t } = useTranslation()
  const [fences, setFences] = React.useState(/** @type {PublicFence[]} */ ([]))
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(/** @type {string|null} */ (null))
  const [expandedFence, setExpandedFence] = React.useState(/** @type {number|null} */ (null))
  const [workerStats, setWorkerStats] = React.useState(/** @type {any} */ (null))

  const loadFences = React.useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      // Get current map center for distance calculation
      // Try to get from global map instance or use default (Stuttgart)
      let lat = 48.7758
      let lng = 9.1829
      
      try {
        // Try to get from Leaflet map if available
        const mapElement = document.querySelector('.leaflet-container')
        /** @type {any} */
        // @ts-ignore - internal reference populated elsewhere
        const leafletMap = mapElement && /** @type {any} */ (mapElement)._leaflet_map
        if (leafletMap && leafletMap.getCenter) {
          const center = leafletMap.getCenter()
          lat = center.lat
          lng = center.lng
        }
      } catch (e) {
        // Use default coordinates
      }

      // Load public fences with distance sorting
      const fencesRes = await fetch(
        `/api/v1/users/fences/public?lat=${lat}&lng=${lng}`, 
        { credentials: 'same-origin' }
      )

      if (fencesRes.ok) {
        const data = await fencesRes.json()
        setFences(data)
      } else {
        throw new Error(t('error_loading_fences', 'Fehler beim Laden der Fences'))
      }

      // Load user's worker stats
      const statsRes = await fetch('/api/v1/users/me/workers', {
        credentials: 'same-origin'
      })

      if (statsRes.ok) {
        const stats = await statsRes.json()
        setWorkerStats(stats)
      }
    } catch (e) {
      console.error('Failed to load fences', e)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadFences()
    // Refresh every 30 seconds
    const interval = setInterval(loadFences, 30000)
    return () => clearInterval(interval)
  }, [loadFences])

  const adjustWorkers = async (fenceId, delta) => {
    try {
      const res = await fetch(`/api/v1/users/fence/${fenceId}/workers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ workerDelta: delta })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.reason || 'Fehler beim Zuweisen der Worker')
      }

      // Reload data
      await loadFences()
    } catch (e) {
      console.error('Failed to adjust workers', e)
      alert(t('assign_workers_failed', 'Fehler beim Zuweisen der Worker'))
    }
  }

  const focusFence = (fence) => {
    try {
      const mapElement = document.querySelector('.leaflet-container')
      /** @type {any} */
      // @ts-ignore - internal reference populated elsewhere
      const map = mapElement && /** @type {any} */ (mapElement)._leaflet_map
      if (!map || !fence?.geometry) return

      let bounds = null
      try {
        const layer = L.geoJSON(fence.geometry)
        if (layer && layer.getBounds) {
          bounds = layer.getBounds()
        }
      } catch (_) {}

      if (bounds && bounds.isValid && bounds.isValid()) {
        map.fitBounds(bounds.pad(0.2))
      } else if (fence.geometry?.type === 'Point' && Array.isArray(fence.geometry.coordinates)) {
        const [lng, lat] = fence.geometry.coordinates
        map.setView([lat, lng], 16)
      }

      try {
        window.dispatchEvent(new CustomEvent('fenceFocused', { detail: fence }))
      } catch (_) {}
    } catch (_) {}
  }

  const getMyWorkers = (fenceId) => {
    return workerStats?.allocations?.find(a => a.fenceId === fenceId)?.workers || 0
  }

  if (loading && fences.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <CircularProgress />
        <Typography variant="body2" sx={{ mt: 2 }}>
          {t('loading_fences', 'Lade Fences...')}
        </Typography>
      </Box>
    )
  }

  if (error) {
    return (
      <Alert severity="error" sx={{ m: 2 }}>
        {error}
      </Alert>
    )
  }

  return (
    <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      {/* Header */}
      <Box sx={{ p: 2, borderBottom: '1px solid rgba(0, 0, 0, 0.12)' }}>
        <Typography variant="h6" sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <MapIcon color="primary" />
          {t('public_fences', 'Öffentliche Fences')} ({fences.length})
        </Typography>
        {workerStats && (
          <Typography variant="caption" color="text.secondary">
            {t('your_workers_assigned', 'Deine Worker: {{alloc}}/{{total}} zugewiesen', { alloc: workerStats.allocated, total: workerStats.total })}
          </Typography>
        )}
      </Box>

      {/* Fence List */}
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {fences.length === 0 ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {t('no_fences_available', 'Keine Fences verfügbar')}
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {fences.map((fence) => {
              const myWorkers = getMyWorkers(fence.id)
              const isExpanded = expandedFence === fence.id

              return (
                <React.Fragment key={fence.id}>
                  <ListItem 
                    disablePadding
                    sx={{ 
                      borderBottom: '1px solid rgba(0, 0, 0, 0.06)',
                      bgcolor: myWorkers > 0 ? 'rgba(76, 175, 80, 0.05)' : 'transparent'
                    }}
                  >
                    <ListItemButton 
                      onClick={() => {
                        setExpandedFence(isExpanded ? null : fence.id)
                        try {
                          window.dispatchEvent(new CustomEvent('focusFenceOnMap', { detail: fence }))
                        } catch (_) {}
                        // Fallback: try to focus directly if event listener not available
                        focusFence(fence)
                      }}
                    >
                      <ListItemText
                        primary={
                          <Stack direction="row" spacing={1} alignItems="center">
                            <Typography variant="body2" sx={{ fontWeight: 600 }}>
                              {fence.name}
                            </Typography>
                            {myWorkers > 0 && (
                              <Chip 
                                label={`${myWorkers} ${t('workers', 'Worker')}`} 
                                size="small" 
                                color="success"
                                sx={{ height: 20 }}
                              />
                            )}
                          </Stack>
                        }
                        secondary={
                          <Stack direction="row" spacing={1.5} sx={{ mt: 0.5 }} flexWrap="wrap">
                            <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                              <WorkIcon sx={{ fontSize: 12 }} />
                              {fence.totalWorkers} {t('workers', 'Worker')}
                            </Typography>
                            <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                              <PeopleIcon sx={{ fontSize: 12 }} />
                              {fence.contributorCount} User
                            </Typography>
                            {fence.distanceKm !== undefined && fence.distanceKm !== null && (
                              <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.3, color: 'primary.main', fontWeight: 600 }}>
                                📍 {fence.distanceKm < 1 
                                  ? `${Math.round(fence.distanceKm * 1000)} m` 
                                  : `${fence.distanceKm} km`}
                              </Typography>
                            )}
                            <Chip 
                              label={fence.mode} 
                              size="small" 
                              sx={{ height: 16, fontSize: '0.65rem' }}
                            />
                          </Stack>
                        }
                      />
                      <IconButton size="small">
                        {isExpanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                      </IconButton>
                    </ListItemButton>
                  </ListItem>

                  <Collapse in={isExpanded} timeout="auto" unmountOnExit>
                    <Box sx={{ p: 2, bgcolor: 'rgba(0, 0, 0, 0.02)' }}>
                      <Stack spacing={1.5}>
                        {/* Fence Info */}
                        <Box>
                          <Typography variant="caption" color="text.secondary">
                            Owner: {(fence.ownerName || fence.owner) || 'Unbekannt'}
                          </Typography>
                          {fence.lastActivity && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                              Letzte Aktivität: {new Date(fence.lastActivity).toLocaleString('de-DE')}
                            </Typography>
                          )}
                        </Box>

                        <Divider />

                        {/* Worker Controls */}
                        {workerStats && (
                          <Box>
                            <Typography variant="caption" sx={{ fontWeight: 600, display: 'block', mb: 1 }}>
                              {t('manage_workers', 'Worker verwalten:')}
                            </Typography>
                            <Stack direction="row" spacing={1} alignItems="center">
                              <IconButton 
                                size="small" 
                                onClick={() => adjustWorkers(fence.id, -1)}
                                disabled={myWorkers === 0}
                                color="error"
                                sx={{ border: '1px solid', borderColor: myWorkers === 0 ? 'grey.300' : 'error.main' }}
                              >
                                <RemoveIcon fontSize="small" />
                              </IconButton>
                              
                              <Chip 
                                label={`${myWorkers} ${t('workers', 'Worker')}`}
                                color={myWorkers > 0 ? 'primary' : 'default'}
                                size="small"
                                sx={{ minWidth: 90 }}
                              />
                              
                              <IconButton 
                                size="small"
                                onClick={() => adjustWorkers(fence.id, 1)}
                                disabled={workerStats.available === 0}
                                color="success"
                                sx={{ border: '1px solid', borderColor: workerStats.available === 0 ? 'grey.300' : 'success.main' }}
                              >
                                <AddIcon fontSize="small" />
                              </IconButton>

                              <Typography variant="caption" color="text.secondary">
                                ({workerStats.available} {t('available', 'verfügbar')})
                              </Typography>
                            </Stack>
                          </Box>
                        )}
                      </Stack>
                    </Box>
                  </Collapse>
                </React.Fragment>
              )
            })}
          </List>
        )}
      </Box>
    </Box>
  )
}
