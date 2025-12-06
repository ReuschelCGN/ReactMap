// @ts-check
import * as React from 'react'
import { IconButton, Drawer, Badge } from '@mui/material'
import MapIcon from '@mui/icons-material/Map'
import { PublicFenceList } from '@features/fence/PublicFenceList'

/**
 * Button to open Public Fence List
 */
export function FenceListButton() {
  const [open, setOpen] = React.useState(false)
  const [fenceCount, setFenceCount] = React.useState(0)

  React.useEffect(() => {
    // Load fence count
    fetch('/api/v1/users/fences/public', { credentials: 'same-origin' })
      .then(r => r.json())
      .then(data => setFenceCount(data.length))
      .catch(() => {})
  }, [])

  return (
    <>
      <IconButton 
        onClick={() => setOpen(true)}
        color="inherit"
        title="Alle Fences anzeigen"
        sx={{ ml: 1 }}
      >
        <Badge badgeContent={fenceCount} color="error">
          <MapIcon />
        </Badge>
      </IconButton>

      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        sx={{ 
          '& .MuiDrawer-paper': { 
            width: 400,
            mt: 8 // Platz für Navbar
          } 
        }}
      >
        <PublicFenceList />
      </Drawer>
    </>
  )
}
