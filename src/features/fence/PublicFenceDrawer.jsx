// @ts-check
import * as React from 'react'
import { Drawer, IconButton, Fab } from '@mui/material'
import MapIcon from '@mui/icons-material/Map'
import EditIcon from '@mui/icons-material/Edit'
import CloseIcon from '@mui/icons-material/Close'
import { PublicFenceList } from './PublicFenceList'
import { useLayoutStore } from '@store/useLayoutStore'
import { useMemory } from '@store/useMemory'

/**
 * Drawer for Public Fence List
 * Opens from the right side
 */
export function PublicFenceDrawer() {
  const [open, setOpen] = React.useState(false)
  const hasFenceEditorPerm = useMemory((s) => s.auth?.perms?.fenceEditor)
  const hasPublicFencesPerm = useMemory((s) => s.auth?.perms?.publicFences)

  return (
    <>
      {/* Fence Editor Button - nur mit fenceEditor Permission */}
      {hasFenceEditorPerm && (
        <Fab
          color="secondary"
          size="medium"
          onClick={() => useLayoutStore.setState({ fence: true })}
          sx={{
            position: 'fixed',
            bottom: 140,
            right: 20,
            zIndex: 1000,
          }}
          title="Fence Editor"
        >
          <EditIcon />
        </Fab>
      )}

      {/* Alle Fences Button - nur mit publicFences Permission */}
      {hasPublicFencesPerm && (
        <Fab
          color="primary"
          size="medium"
          onClick={() => setOpen(true)}
          sx={{
            position: 'fixed',
            bottom: 80,
            right: 20,
            zIndex: 1000,
          }}
          title="Alle Fences anzeigen"
        >
          <MapIcon />
        </Fab>
      )}

      {/* Drawer */}
      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        sx={{
          '& .MuiDrawer-paper': {
            width: { xs: '100%', sm: 400 },
            mt: { xs: 0, sm: 8 },
          },
        }}
      >
        {/* Close Button */}
        <IconButton
          onClick={() => setOpen(false)}
          sx={{
            position: 'absolute',
            top: 8,
            right: 8,
            zIndex: 1,
          }}
        >
          <CloseIcon />
        </IconButton>

        <PublicFenceList />
      </Drawer>
    </>
  )
}
