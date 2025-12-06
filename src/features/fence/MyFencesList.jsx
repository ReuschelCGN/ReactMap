// @ts-check
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { 
  Box, 
  Typography, 
  List,
  ListItem,
  ListItemText,
  IconButton,
  Stack,
  CircularProgress,
  Alert,
  Chip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Tooltip
} from '@mui/material'
import DeleteIcon from '@mui/icons-material/Delete'
import EditIcon from '@mui/icons-material/Edit'
import MapIcon from '@mui/icons-material/Map'
import WorkIcon from '@mui/icons-material/Work'
import CloudIcon from '@mui/icons-material/Cloud'

/**
 * My Fences List Component
 * Shows user's own fences with edit/delete options
 */
export function MyFencesList() {
  const { t } = useTranslation()
  const [fences, setFences] = React.useState([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState(null)
  const [deleteDialog, setDeleteDialog] = React.useState({ open: false, fence: null })
  const [workerStats, setWorkerStats] = React.useState(null)

  const loadFences = React.useCallback(async () => {
    try {
      setLoading(true)
      setError(null)

      // Load user's fences
      const fencesRes = await fetch('/api/v1/users/geofence', {
        credentials: 'same-origin'
      })

      if (fencesRes.ok) {
        const data = await fencesRes.json()
        setFences(data.features || [])
      } else if (fencesRes.status === 401) {
        setError(t('login_required_view_fences', 'Bitte melde dich an, um deine Fences zu sehen.'))
      } else {
        throw new Error(t('error_loading_fences', 'Fehler beim Laden der Fences'))
      }

      // Load worker stats
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

  const handleDelete = async (fence) => {
    try {
      const fenceId = fence.properties?.id
      if (!fenceId) {
        alert(t('fence_id_not_found', 'Fence ID nicht gefunden'))
        return
      }

      const res = await fetch(`/api/v1/users/geofence/${fenceId}`, {
        method: 'DELETE',
        credentials: 'same-origin'
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.reason || t('error_deleting_fence', 'Fehler beim Löschen der Fence'))
      }

      const result = await res.json()
      
      // Show warning if partial success
      if (result.status === 'partial') {
        alert(result.message || t('warn_dragonite_sync_failed', 'Warnung: Dragonite-Synchronisation fehlgeschlagen'))
      }

      // Reload fences
      await loadFences()
      setDeleteDialog({ open: false, fence: null })
    } catch (e) {
      console.error('Failed to delete fence', e)
      alert(t('error_deleting_with_message', 'Fehler beim Löschen: {{msg}}', { msg: e.message }))
    }
  }

  const handleEdit = (fence) => {
    // TODO: Implement edit functionality
    // This could open a dialog with a map to edit the geometry
    alert(t('edit_not_implemented', 'Bearbeiten-Funktion wird noch implementiert. Verwende vorerst das Fence-Tool auf der Karte.'))
  }

  if (loading && fences.length === 0) {
    return (
      <Box sx={{ p: 3, textAlign: 'center' }}>
        <CircularProgress />
        <Typography variant="body2" sx={{ mt: 2 }}>
          {t('loading_your_fences', 'Lade deine Fences...')}
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
          {t('my_fences', 'Meine Fences')} ({fences.length})
        </Typography>
        {workerStats && (
          <Typography variant="caption" color="text.secondary">
            {t('you_can_create_up_to', 'Du kannst max. {{count}} Fences erstellen (1 pro Worker)', { count: workerStats.total })}
          </Typography>
        )}
      </Box>

      {/* Fence List */}
      <Box sx={{ flex: 1, overflowY: 'auto' }}>
        {fences.length === 0 ? (
          <Box sx={{ p: 3, textAlign: 'center' }}>
            <Typography variant="body2" color="text.secondary">
              {t('no_fences_created', 'Du hast noch keine Fences erstellt.')}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
              {t('use_fence_tool_hint', 'Verwende das Fence-Tool auf der Karte, um eine neue Fence zu erstellen.')}
            </Typography>
          </Box>
        ) : (
          <List disablePadding>
            {fences.map((fence) => {
              const props = fence.properties || {}
              const fenceId = props.id
              const name = props.name || t('unnamed', 'Unbenannt')
              const mode = props.mode || 'auto_quest'
              const createdAt = props.created_at ? new Date(props.created_at).toLocaleDateString() : '-'

              return (
                <ListItem 
                  key={fenceId}
                  disablePadding
                  sx={{ 
                    borderBottom: '1px solid rgba(0, 0, 0, 0.06)',
                    px: 2,
                    py: 1.5
                  }}
                >
                  <ListItemText
                    primary={
                      <Stack direction="row" spacing={1} alignItems="center">
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {name}
                        </Typography>
                        <Chip 
                          label={mode} 
                          size="small" 
                          sx={{ height: 20, fontSize: '0.7rem' }}
                        />
                      </Stack>
                    }
                    secondary={
                      <Stack direction="row" spacing={1.5} sx={{ mt: 0.5 }}>
                        <Typography variant="caption" sx={{ display: 'flex', alignItems: 'center', gap: 0.3 }}>
                          ID: {fenceId}
                        </Typography>
                        <Typography variant="caption">
                          Erstellt: {createdAt}
                        </Typography>
                      </Stack>
                    }
                  />
                  
                  <Stack direction="row" spacing={0.5}>
                    <Tooltip title={t('edit_in_progress', 'Bearbeiten (in Entwicklung)')}>
                      <IconButton 
                        size="small"
                        onClick={() => handleEdit(fence)}
                        disabled
                        sx={{ color: 'primary.main' }}
                      >
                        <EditIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                    
                    <Tooltip title={t('delete', 'Löschen')}>
                      <IconButton 
                        size="small"
                        onClick={() => setDeleteDialog({ open: true, fence })}
                        sx={{ color: 'error.main' }}
                      >
                        <DeleteIcon fontSize="small" />
                      </IconButton>
                    </Tooltip>
                  </Stack>
                </ListItem>
              )
            })}
          </List>
        )}
      </Box>

      {/* Delete Confirmation Dialog */}
      <Dialog
        open={deleteDialog.open}
        onClose={() => setDeleteDialog({ open: false, fence: null })}
      >
        <DialogTitle>{t('delete_fence_title', 'Fence löschen?')}</DialogTitle>
        <DialogContent>
          <Typography>
            {t('delete_fence_confirm', 'Möchtest du die Fence "{{name}}" wirklich löschen?', { name: deleteDialog.fence?.properties?.name || t('unnamed', 'Unbenannt') })}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1 }}>
            {t('delete_irreversible_hint', 'Diese Aktion kann nicht rückgängig gemacht werden. Die Fence wird aus Koji und Dragonite gelöscht.')}
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDeleteDialog({ open: false, fence: null })}>
            {t('cancel', 'Abbrechen')}
          </Button>
          <Button 
            onClick={() => handleDelete(deleteDialog.fence)} 
            color="error"
            variant="contained"
          >
            {t('delete', 'Löschen')}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  )
}
