// @ts-check
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { 
  Box, 
  Typography, 
  IconButton, 
  Chip, 
  Stack, 
  List, 
  ListItem, 
  ListItemText,
  CircularProgress,
  Alert,
  Divider
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import PeopleIcon from '@mui/icons-material/People'
import WorkIcon from '@mui/icons-material/Work'

/**
 * @typedef {Object} WorkerStats
 * @property {number} total
 * @property {number} allocated
 * @property {number} available
 * @property {Array<{fenceId: number, fenceName: string, isOwner: boolean, workers: number}>} allocations
 */

/**
 * @typedef {Object} Contributor
 * @property {string} userId
 * @property {string} userName
 * @property {number} workers
 * @property {boolean} isOwner
 */

/**
 * Worker Management Component
 * @param {Object} props
 * @param {number} props.fenceId - Current fence ID
 * @param {string} props.fenceName - Current fence name
 * @param {boolean} [props.isOwner] - Is current user the owner
 */
export function WorkerManager({ fenceId, fenceName, isOwner = false }) {
  const { t } = useTranslation()
  const [workerStats, setWorkerStats] = React.useState(/** @type {WorkerStats|null} */ (null))
  const [contributors, setContributors] = React.useState(/** @type {Contributor[]} */ ([]))
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(/** @type {string|null} */ (null))
  // Ensure we only attempt auto-sync once per fence to avoid loops when 0 workers
  const triedAutoSyncRef = React.useRef(false)

  // Load worker stats and contributors
  const loadData = React.useCallback(async () => {
    if (!fenceId) return
    
    try {
      setLoading(true)
      setError(null)

      // Load user's worker stats
      const statsRes = await fetch('/api/v1/users/me/workers', {
        credentials: 'same-origin'
      })
      
      if (statsRes.ok) {
        const stats = await statsRes.json()
        setWorkerStats(stats)
      } else if (statsRes.status === 401) {
        setError(t('login_required_manage_workers', 'Bitte melde dich an, um Worker zu verwalten'))
      }

      // Load fence contributors
      const contribRes = await fetch(`/api/v1/users/fence/${fenceId}/contributors`, {
        credentials: 'same-origin'
      })
      
      if (contribRes.ok) {
        const data = await contribRes.json()
        setContributors(data.contributors || [])
        
        // Auto-sync if no contributors but fence exists (only once per fence)
        if (data.contributors.length === 0 && isOwner && !triedAutoSyncRef.current) {
          triedAutoSyncRef.current = true
          console.log('WorkerManager: No contributors found, attempting auto-sync')
          await syncFromDragonite()
        }
      }
    } catch (e) {
      console.error('Failed to load worker data', e)
      setError(t('failed_to_load_workers', 'Fehler beim Laden der Worker-Daten'))
    } finally {
      setLoading(false)
    }
  }, [fenceId, isOwner])

  const syncFromDragonite = async () => {
    try {
      const res = await fetch(`/api/v1/users/fence/${fenceId}/sync-workers`, {
        method: 'POST',
        credentials: 'same-origin'
      })

      if (res.ok) {
        const data = await res.json()
        console.log('WorkerManager: Synced', data.synced, 'workers from Dragonite')
        // Reload data after sync
        await loadData()
      }
    } catch (e) {
      console.error('Failed to sync workers', e)
    }
  }

  React.useEffect(() => {
    // Reset auto-sync attempt when switching fence
    triedAutoSyncRef.current = false
    loadData()
    // Refresh every 10 seconds
    const interval = setInterval(loadData, 10000)
    return () => clearInterval(interval)
  }, [loadData])

  const adjustWorkers = async (delta) => {
    if (!fenceId) return
    
    try {
      setLoading(true)
      setError(null)

      const res = await fetch(`/api/v1/users/fence/${fenceId}/workers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ workerDelta: delta })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.reason || t('assign_workers_failed', 'Fehler beim Zuweisen der Worker'))
      }

      // Reload data
      await loadData()
      try { window.dispatchEvent(new Event('userWorkersChanged')) } catch (_) {}
    } catch (e) {
      console.error('Failed to adjust workers', e)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  const myWorkers = workerStats?.allocations?.find(a => a.fenceId === fenceId)?.workers || 0
  const totalWorkers = contributors.reduce((sum, c) => sum + c.workers, 0)

  if (!workerStats) {
    return (
      <Box sx={{ p: 2, textAlign: 'center' }}>
        <CircularProgress size={24} />
      </Box>
    )
  }

  return (
    <Box sx={{ 
      p: 2, 
      border: '1px solid rgba(25, 118, 210, 0.3)', 
      borderRadius: 2,
      background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.05) 0%, rgba(25, 118, 210, 0.02) 100%)'
    }}>
      <Typography variant="h6" sx={{ mb: 2, display: 'flex', alignItems: 'center', gap: 1, color: '#000', fontWeight: 700 }}>
        <WorkIcon color="primary" />
        {t('worker_management', 'Worker-Verwaltung')}
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }} onClose={() => setError(null)}>
          {error}
        </Alert>
      )}

      {/* Meine Worker-Statistik */}
      <Box sx={{ 
        p: 1.5, 
        mb: 2,
        bgcolor: 'rgba(255, 255, 255, 0.7)', 
        borderRadius: 1,
        border: '1px solid rgba(0, 0, 0, 0.1)'
      }}>
        <Typography variant="body2" sx={{ fontWeight: 600, mb: 0.5 }}>
          👤 {t('my_workers', 'Meine Worker')}
        </Typography>
        <Stack direction="row" spacing={2} alignItems="center">
          <Chip 
            label={`${workerStats.allocated}/${workerStats.total} ${t('assigned', 'zugewiesen')}`}
            color="primary"
            size="small"
          />
          <Chip 
            label={`${workerStats.available} ${t('available', 'verfügbar')}`}
            color={workerStats.available > 0 ? 'success' : 'default'}
            size="small"
          />
        </Stack>
      </Box>

      {/* Worker an dieser Fence */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, color: '#000' }}>
          {t('workers_on_fence', 'Worker an "{{name}}"').replace('{{name}}', fenceName)}
        </Typography>
        
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1} alignItems="center">
            <IconButton 
              size="small" 
              onClick={() => adjustWorkers(-1)}
              disabled={myWorkers === 0 || loading}
              color="error"
              sx={{ 
                border: '1px solid',
                borderColor: myWorkers === 0 ? 'grey.300' : 'error.main'
              }}
            >
              <RemoveIcon fontSize="small" />
            </IconButton>
            
            <Chip 
              label={`${myWorkers} ${t('workers', 'Worker')}`}
              color={myWorkers > 0 ? 'primary' : 'default'}
              sx={{ minWidth: 100, fontWeight: 600 }}
            />
            
            <IconButton 
              size="small"
              onClick={() => adjustWorkers(1)}
              disabled={workerStats.available === 0 || loading}
              color="success"
              sx={{ 
                border: '1px solid',
                borderColor: workerStats.available === 0 ? 'grey.300' : 'success.main'
              }}
            >
              <AddIcon fontSize="small" />
            </IconButton>
          </Stack>

          {loading && <CircularProgress size={20} />}
        </Stack>

        <Typography variant="caption" sx={{ mt: 0.5, display: 'block', color: '#666' }}>
          {t('workers_hint', 'Klicke + oder - um Worker zuzuweisen oder zu entfernen')}
        </Typography>
      </Box>

      <Divider sx={{ my: 2 }} />

      {/* Alle Contributors */}
      <Box>
        <Typography variant="subtitle2" sx={{ mb: 1, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 0.5, color: '#000' }}>
          <PeopleIcon fontSize="small" />
          {t('all_contributors', 'Alle Mitwirkenden')} ({contributors.length})
        </Typography>
        
        <Box sx={{ 
          maxHeight: 200, 
          overflowY: 'auto',
          border: '1px solid rgba(0, 0, 0, 0.1)',
          borderRadius: 1,
          bgcolor: 'rgba(255, 255, 255, 0.5)'
        }}>
          {contributors.length === 0 ? (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="caption" sx={{ color: '#666' }}>
                {t('no_workers_assigned', 'Noch keine Worker zugewiesen')}
              </Typography>
            </Box>
          ) : (
            <List dense disablePadding>
              {contributors.map((c, idx) => (
                <ListItem 
                  key={c.userId}
                  sx={{ 
                    borderBottom: idx < contributors.length - 1 ? '1px solid rgba(0, 0, 0, 0.05)' : 'none',
                    bgcolor: c.isOwner ? 'rgba(76, 175, 80, 0.1)' : 'transparent'
                  }}
                >
                  <ListItemText 
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2" sx={{ fontWeight: c.isOwner ? 600 : 400, color: '#000' }}>
                          {c.userName || c.userId}
                        </Typography>
                        {c.isOwner && (
                          <Chip label={t('owner', 'Owner')} size="small" color="success" sx={{ height: 20 }} />
                        )}
                      </Stack>
                    }
                    secondary={`${c.workers} ${t('workers', 'Worker')}`}
                    secondaryTypographyProps={{ sx: { color: '#666' } }}
                  />
                </ListItem>
              ))}
            </List>
          )}
        </Box>

        {totalWorkers > 0 && (
          <Box sx={{ mt: 1, p: 1, bgcolor: 'rgba(25, 118, 210, 0.1)', borderRadius: 1 }}>
            <Typography variant="caption" sx={{ fontWeight: 600, color: '#000' }}>
              📊 {t('total_active_workers', 'Gesamt: {{count}} Worker aktiv', { count: totalWorkers })}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  )
}
