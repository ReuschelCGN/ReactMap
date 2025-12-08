// @ts-check
import * as React from 'react'
import { 
  Box, 
  Typography, 
  Paper,
  List,
  ListItem,
  ListItemText,
  Chip,
  Stack,
  Divider,
  IconButton,
  Collapse
} from '@mui/material'
import WorkIcon from '@mui/icons-material/Work'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import MapIcon from '@mui/icons-material/Map'

/**
 * Worker Overview Widget - Shows all worker assignments
 * @param {Object} props
 * @param {Function} props.onFenceSelect - Callback when a fence is selected from the list
 */
export function WorkerOverview({ onFenceSelect }) {
  const [workerStats, setWorkerStats] = React.useState(null)
  const [allFences, setAllFences] = React.useState([])
  const [expanded, setExpanded] = React.useState(true)
  const [showAllFences, setShowAllFences] = React.useState(false)

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

  const loadAllFences = React.useCallback(async () => {
    try {
      const res = await fetch('/api/v1/users/fences/public', {
        credentials: 'same-origin'
      })
      
      if (res.ok) {
        const fences = await res.json()
        setAllFences(fences)
      }
    } catch (e) {
      console.error('Failed to load all fences', e)
    }
  }, [])

  React.useEffect(() => {
    loadWorkerStats()
    loadAllFences()
    // Refresh every 10 seconds
    const interval = setInterval(() => {
      loadWorkerStats()
      loadAllFences()
    }, 10000)
    return () => clearInterval(interval)
  }, [loadWorkerStats, loadAllFences])

  if (!workerStats) return null

  const hasAllocations = workerStats.allocations && workerStats.allocations.length > 0
  const unassignedFences = allFences.filter(fence => 
    !workerStats.allocations?.some(a => a.fenceId === fence.id)
  )

  return (
    <Paper
      elevation={6}
      sx={{
        position: 'fixed',
        top: 80,
        left: 10,
        zIndex: 1000,
        minWidth: 280,
        maxWidth: 320,
        background: 'linear-gradient(135deg, rgba(255, 255, 255, 0.98) 0%, rgba(250, 250, 255, 0.98) 100%)',
        backdropFilter: 'blur(12px)',
        borderRadius: 2,
        border: '1px solid rgba(76, 175, 80, 0.3)',
      }}
    >
      <Box sx={{ p: 2 }}>
        {/* Header */}
        <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
          <Typography variant="h6" sx={{ fontWeight: 700, fontSize: '1rem', color: '#000', display: 'flex', alignItems: 'center', gap: 0.5 }}>
            <WorkIcon color="success" fontSize="small" />
            Worker-Übersicht
          </Typography>
          <IconButton size="small" onClick={() => setExpanded(!expanded)}>
            {expanded ? <ExpandLessIcon /> : <ExpandMoreIcon />}
          </IconButton>
        </Stack>

        {/* Summary Stats */}
        <Stack direction="row" spacing={1} sx={{ mb: 1.5 }}>
          <Chip 
            label={`${workerStats.allocated}/${workerStats.total}`}
            color="primary"
            size="small"
            sx={{ fontWeight: 600 }}
          />
          <Chip 
            label={`${workerStats.available} frei`}
            color={workerStats.available > 0 ? 'success' : 'default'}
            size="small"
          />
        </Stack>

        <Collapse in={expanded}>
          <Divider sx={{ mb: 1.5 }} />

          {/* Allocations List */}
          {hasAllocations ? (
            <Box>
              <Typography variant="caption" sx={{ fontWeight: 600, color: '#666', display: 'block', mb: 1 }}>
                Zugewiesene Fences:
              </Typography>
              <List dense disablePadding sx={{ 
                maxHeight: 300, 
                overflowY: 'auto',
                border: '1px solid rgba(0, 0, 0, 0.1)',
                borderRadius: 1,
                bgcolor: 'rgba(255, 255, 255, 0.5)'
              }}>
                {workerStats.allocations.map((allocation, idx) => (
                  <ListItem 
                    key={allocation.fenceId}
                    sx={{ 
                      borderBottom: idx < workerStats.allocations.length - 1 ? '1px solid rgba(0, 0, 0, 0.05)' : 'none',
                      py: 1
                    }}
                  >
                    <ListItemText
                      primary={
                        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
                            <MapIcon sx={{ fontSize: 14, color: '#1976d2', flexShrink: 0 }} />
                            <Typography 
                              variant="body2" 
                              sx={{ 
                                fontWeight: 600, 
                                color: '#000',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                whiteSpace: 'nowrap'
                              }}
                            >
                              {allocation.fenceName}
                            </Typography>
                          </Box>
                          <Chip 
                            label={`${allocation.workers}W`}
                            size="small"
                            color="success"
                            sx={{ 
                              height: 20, 
                              fontSize: '0.7rem',
                              fontWeight: 700,
                              minWidth: 40,
                              flexShrink: 0
                            }}
                          />
                        </Stack>
                      }
                      secondary={
                        allocation.isOwner ? (
                          <Typography variant="caption" sx={{ color: '#4caf50', fontWeight: 600 }}>
                            👑 Deine Fence
                          </Typography>
                        ) : null
                      }
                    />
                  </ListItem>
                ))}
              </List>
            </Box>
          ) : (
            <Box sx={{ 
              p: 2, 
              textAlign: 'center',
              bgcolor: 'rgba(0, 0, 0, 0.02)',
              borderRadius: 1
            }}>
              <Typography variant="caption" sx={{ color: '#666' }}>
                Noch keine Worker zugewiesen
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: '#999' }}>
                Wähle eine Fence unten aus
              </Typography>
            </Box>
          )}

          {/* Other Available Fences */}
          {unassignedFences.length > 0 && (
            <>
              <Divider sx={{ my: 1.5 }} />
              <Box>
                <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 1 }}>
                  <Typography variant="caption" sx={{ fontWeight: 600, color: '#666' }}>
                    Andere Fences ({unassignedFences.length}):
                  </Typography>
                  <IconButton size="small" onClick={() => setShowAllFences(!showAllFences)}>
                    {showAllFences ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
                  </IconButton>
                </Stack>
                
                <Collapse in={showAllFences}>
                  <List dense disablePadding sx={{ 
                    maxHeight: 200, 
                    overflowY: 'auto',
                    border: '1px solid rgba(0, 0, 0, 0.1)',
                    borderRadius: 1,
                    bgcolor: 'rgba(255, 255, 255, 0.3)'
                  }}>
                    {unassignedFences.map((fence, idx) => (
                      <ListItem 
                        key={fence.id}
                        button
                        onClick={() => onFenceSelect && onFenceSelect(fence)}
                        sx={{ 
                          borderBottom: idx < unassignedFences.length - 1 ? '1px solid rgba(0, 0, 0, 0.05)' : 'none',
                          py: 0.8,
                          '&:hover': {
                            bgcolor: 'rgba(25, 118, 210, 0.08)'
                          }
                        }}
                      >
                        <ListItemText
                          primary={
                            <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
                              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, flex: 1, minWidth: 0 }}>
                                <MapIcon sx={{ fontSize: 12, color: '#666', flexShrink: 0 }} />
                                <Typography 
                                  variant="caption" 
                                  sx={{ 
                                    color: '#333',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap'
                                  }}
                                >
                                  {fence.name}
                                </Typography>
                              </Box>
                              <Chip 
                                label={`${fence.totalWorkers}W`}
                                size="small"
                                sx={{ 
                                  height: 18, 
                                  fontSize: '0.65rem',
                                  minWidth: 35,
                                  flexShrink: 0
                                }}
                              />
                            </Stack>
                          }
                        />
                      </ListItem>
                    ))}
                  </List>
                </Collapse>
              </Box>
            </>
          )}
        </Collapse>
      </Box>
    </Paper>
  )
}
