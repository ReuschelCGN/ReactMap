// @ts-check
import * as React from 'react'
import { 
  Box, 
  Typography, 
  Paper,
  Stack,
  Chip,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Divider,
  IconButton,
  Collapse
} from '@mui/material'
import WorkIcon from '@mui/icons-material/Work'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import ExpandLessIcon from '@mui/icons-material/ExpandLess'
import TrendingUpIcon from '@mui/icons-material/TrendingUp'

/**
 * Worker Statistics Widget
 * Compact widget showing user's worker allocation
 */
export function WorkerStatsWidget() {
  const [stats, setStats] = React.useState(null)
  const [expanded, setExpanded] = React.useState(false)
  const [loading, setLoading] = React.useState(true)

  const loadStats = React.useCallback(async () => {
    try {
      const res = await fetch('/api/v1/users/me/workers', {
        credentials: 'same-origin'
      })

      if (res.ok) {
        const data = await res.json()
        setStats(data)
      }
    } catch (e) {
      console.error('Failed to load worker stats', e)
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    loadStats()
    // Refresh every 15 seconds
    const interval = setInterval(loadStats, 15000)
    return () => clearInterval(interval)
  }, [loadStats])

  if (loading || !stats) {
    return null
  }

  const usagePercent = (stats.allocated / stats.total) * 100

  return (
    <Paper 
      elevation={3}
      sx={{ 
        position: 'fixed',
        bottom: 20,
        right: 20,
        width: 280,
        zIndex: 1000,
        overflow: 'hidden'
      }}
    >
      {/* Header */}
      <Box 
        sx={{ 
          p: 1.5,
          background: 'linear-gradient(135deg, rgba(25, 118, 210, 0.1) 0%, rgba(25, 118, 210, 0.05) 100%)',
          borderBottom: '1px solid rgba(0, 0, 0, 0.12)',
          cursor: 'pointer'
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Stack direction="row" alignItems="center" spacing={1}>
            <WorkIcon color="primary" fontSize="small" />
            <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
              Meine Worker
            </Typography>
          </Stack>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Chip 
              label={`${stats.allocated}/${stats.total}`}
              size="small"
              color={stats.available > 0 ? 'success' : 'warning'}
              sx={{ height: 22, fontWeight: 600 }}
            />
            <IconButton size="small">
              {expanded ? <ExpandLessIcon fontSize="small" /> : <ExpandMoreIcon fontSize="small" />}
            </IconButton>
          </Stack>
        </Stack>

        {/* Progress Bar */}
        <Box sx={{ mt: 1 }}>
          <LinearProgress 
            variant="determinate" 
            value={usagePercent}
            sx={{ 
              height: 6, 
              borderRadius: 3,
              bgcolor: 'rgba(0, 0, 0, 0.1)',
              '& .MuiLinearProgress-bar': {
                bgcolor: stats.available === 0 ? 'warning.main' : 'success.main'
              }
            }}
          />
          <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5, display: 'block' }}>
            {stats.available} Worker verfügbar
          </Typography>
        </Box>
      </Box>

      {/* Expanded Content */}
      <Collapse in={expanded} timeout="auto">
        <Box sx={{ maxHeight: 300, overflowY: 'auto' }}>
          {stats.allocations.length === 0 ? (
            <Box sx={{ p: 2, textAlign: 'center' }}>
              <Typography variant="caption" color="text.secondary">
                Noch keine Worker zugewiesen
              </Typography>
            </Box>
          ) : (
            <List dense disablePadding>
              {stats.allocations.map((allocation, idx) => (
                <React.Fragment key={allocation.fenceId}>
                  <ListItem 
                    sx={{ 
                      py: 1,
                      bgcolor: allocation.isOwner ? 'rgba(76, 175, 80, 0.08)' : 'transparent'
                    }}
                  >
                    <ListItemText
                      primary={
                        <Stack direction="row" spacing={0.5} alignItems="center">
                          <Typography variant="body2" sx={{ fontWeight: allocation.isOwner ? 600 : 400 }}>
                            {allocation.fenceName}
                          </Typography>
                          {allocation.isOwner && (
                            <Chip label="Meine" size="small" color="success" sx={{ height: 18, fontSize: '0.65rem' }} />
                          )}
                        </Stack>
                      }
                      secondary={
                        <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.3 }}>
                          <Chip 
                            label={`${allocation.workers} Worker`}
                            size="small"
                            color="primary"
                            sx={{ height: 18, fontSize: '0.65rem' }}
                          />
                          <TrendingUpIcon sx={{ fontSize: 12, color: 'success.main' }} />
                        </Stack>
                      }
                    />
                  </ListItem>
                  {idx < stats.allocations.length - 1 && <Divider />}
                </React.Fragment>
              ))}
            </List>
          )}
        </Box>

        {/* Footer */}
        <Box 
          sx={{ 
            p: 1,
            bgcolor: 'rgba(0, 0, 0, 0.02)',
            borderTop: '1px solid rgba(0, 0, 0, 0.12)',
            textAlign: 'center'
          }}
        >
          <Typography variant="caption" color="text.secondary">
            💡 Klicke auf Fences um Worker zu verwalten
          </Typography>
        </Box>
      </Collapse>
    </Paper>
  )
}
