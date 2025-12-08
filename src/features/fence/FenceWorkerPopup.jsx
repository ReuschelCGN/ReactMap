// @ts-check
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { 
  Box, 
  Typography, 
  IconButton, 
  Chip, 
  Stack, 
  Paper,
  Divider,
  CircularProgress
} from '@mui/material'
import AddIcon from '@mui/icons-material/Add'
import RemoveIcon from '@mui/icons-material/Remove'
import CloseIcon from '@mui/icons-material/Close'
import WorkIcon from '@mui/icons-material/Work'

/**
 * Popup component for managing workers on a selected fence
 * @param {Object} props
 * @param {Object|null} props.selectedFence - Currently selected fence data
 * @param {Function} props.onClose - Callback to close the popup
 */
export function FenceWorkerPopup({ selectedFence, onClose }) {
  const { t } = useTranslation()
  const [workerStats, setWorkerStats] = React.useState(null)
  const [loading, setLoading] = React.useState(false)
  const [error, setError] = React.useState(null)

  // Load worker stats
  const loadWorkerStats = React.useCallback(async () => {
    try {
      const res = await fetch('/api/v1/users/me/workers', {
        credentials: 'same-origin'
      })
      
      if (res.ok) {
        const stats = await res.json()
        setWorkerStats(stats)
      }
    } catch (e) {
      console.error('Failed to load worker stats', e)
    }
  }, [])

  React.useEffect(() => {
    if (selectedFence) {
      console.log('FenceWorkerPopup: Loading data for fence:', selectedFence.id, selectedFence.name)
      // Reset state when fence changes
      setWorkerStats(null)
      setError(null)
      setLoading(false)
      
      loadWorkerStats()
      // Refresh every 5 seconds
      const interval = setInterval(loadWorkerStats, 5000)
      return () => clearInterval(interval)
    }
  }, [selectedFence?.id, loadWorkerStats]) // Use selectedFence.id to trigger reload on fence change

  const adjustWorkers = async (delta) => {
    if (!selectedFence) return
    
    try {
      setLoading(true)
      setError(null)

      const res = await fetch(`/api/v1/users/fence/${selectedFence.id}/workers`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ workerDelta: delta })
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.reason || t('assign_workers_failed', 'Fehler beim Zuweisen der Worker'))
      }

      // Reload stats
      await loadWorkerStats()
      try { window.dispatchEvent(new Event('userWorkersChanged')) } catch (_) {}
    } catch (e) {
      console.error('Failed to adjust workers', e)
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }

  if (!selectedFence) return null

  const myWorkers = workerStats?.allocations?.find(a => a.fenceId === selectedFence.id)?.workers || 0

  return (
    <Paper
      elevation={12}
      sx={{
        position: 'fixed',
        bottom: 20,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 2000,
        minWidth: 350,
        maxWidth: 450,
        background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(240, 248, 255, 0.98) 100%)',
        backdropFilter: 'blur(12px)',
        borderRadius: 3,
        border: '2px solid rgba(0, 255, 0, 0.4)',
        boxShadow: '0 8px 32px rgba(0, 255, 0, 0.3)',
      }}
    >
      <Box sx={{ p: 2.5 }}>
        {/* Header */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, color: '#000', display: 'flex', alignItems: 'center', gap: 1 }}>
            <WorkIcon color="success" />
            {t('worker_management', 'Worker-Verwaltung')}
          </Typography>
          <IconButton size="small" onClick={() => onClose()} sx={{ color: '#666' }}>
            <CloseIcon />
          </IconButton>
        </Stack>

        {/* Fence Info */}
        <Box sx={{ 
          p: 1.5, 
          mb: 2,
          bgcolor: 'rgba(0, 255, 0, 0.1)', 
          borderRadius: 2,
          border: '1px solid rgba(0, 255, 0, 0.3)'
        }}>
          <Typography variant="body1" sx={{ fontWeight: 700, color: '#000', mb: 0.5 }}>
            📍 {selectedFence.name}
          </Typography>
          <Stack direction="row" spacing={1.5} flexWrap="wrap">
            <Chip 
              label={`${selectedFence.totalWorkers} ${t('workers_total', 'Worker gesamt')}`}
              size="small"
              color="primary"
              sx={{ height: 22 }}
            />
            <Chip 
              label={selectedFence.mode}
              size="small"
              variant="outlined"
              sx={{ height: 22 }}
            />
            <Typography variant="caption" sx={{ color: '#666', lineHeight: '22px' }}>
              {t('owner', 'Owner')}: {(selectedFence.ownerName || selectedFence.owner) || t('unknown', 'Unbekannt')}
            </Typography>
          </Stack>
        </Box>

        <Divider sx={{ my: 2 }} />

        {/* Worker Controls */}
        {workerStats ? (
          <Box>
            <Typography variant="body2" sx={{ fontWeight: 600, mb: 1.5, color: '#000' }}>
              {t('your_worker_allocation', 'Deine Worker-Zuweisung:')}
            </Typography>
            
            <Stack direction="row" spacing={2} alignItems="center" justifyContent="center" sx={{ mb: 2 }}>
              <IconButton 
                size="medium" 
                onClick={() => adjustWorkers(-1)}
                disabled={myWorkers === 0 || loading}
                color="error"
                sx={{ 
                  border: '2px solid',
                  borderColor: myWorkers === 0 ? 'grey.300' : 'error.main',
                  '&:hover': {
                    transform: 'scale(1.1)',
                    transition: 'transform 0.2s'
                  }
                }}
              >
                <RemoveIcon />
              </IconButton>
              
              <Chip 
                label={`${myWorkers} ${t('workers', 'Worker')}`}
                color={myWorkers > 0 ? 'success' : 'default'}
                sx={{ 
                  minWidth: 120, 
                  fontWeight: 700,
                  fontSize: '1rem',
                  height: 36
                }}
              />
              
              <IconButton 
                size="medium"
                onClick={() => adjustWorkers(1)}
                disabled={workerStats.available === 0 || loading}
                color="success"
                sx={{ 
                  border: '2px solid',
                  borderColor: workerStats.available === 0 ? 'grey.300' : 'success.main',
                  '&:hover': {
                    transform: 'scale(1.1)',
                    transition: 'transform 0.2s'
                  }
                }}
              >
                <AddIcon />
              </IconButton>
            </Stack>

            {/* User Stats */}
            <Box sx={{ 
              p: 1.5, 
              bgcolor: 'rgba(25, 118, 210, 0.08)', 
              borderRadius: 1.5,
              border: '1px solid rgba(25, 118, 210, 0.2)'
            }}>
              <Stack direction="row" spacing={2} justifyContent="center">
                <Chip 
                  label={`${workerStats.allocated}/${workerStats.total} ${t('assigned', 'zugewiesen')}`}
                  color="primary"
                  size="small"
                  variant="outlined"
                />
                <Chip 
                  label={`${workerStats.available} ${t('available', 'verfügbar')}`}
                  color={workerStats.available > 0 ? 'success' : 'default'}
                  size="small"
                />
              </Stack>
            </Box>

            {error && (
              <Typography variant="caption" color="error" sx={{ display: 'block', mt: 1, textAlign: 'center' }}>
                {error}
              </Typography>
            )}

            {loading && (
              <Box sx={{ display: 'flex', justifyContent: 'center', mt: 1 }}>
                <CircularProgress size={20} />
              </Box>
            )}
          </Box>
        ) : (
          <Box sx={{ textAlign: 'center', py: 2 }}>
            <CircularProgress size={24} />
          </Box>
        )}

        <Typography variant="caption" sx={{ display: 'block', mt: 2, textAlign: 'center', color: '#666' }}>
          💡 {t('workers_hint', 'Klicke + oder - um Worker zuzuweisen oder zu entfernen')}
        </Typography>
      </Box>
    </Paper>
  )
}
