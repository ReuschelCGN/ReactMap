# 🎨 UI-Komponenten - Worker System

## Übersicht der erstellten Komponenten

### 1. **WorkerManager.jsx**
Hauptkomponente für Worker-Verwaltung in FencePanel.

**Features:**
- Zeigt User's Worker-Statistik (zugewiesen/verfügbar)
- Worker hinzufügen/entfernen mit +/- Buttons
- Liste aller Contributors mit Owner-Badge
- Live-Updates alle 10 Sekunden
- Error-Handling mit Alert-Messages

**Integration:**
```jsx
import { WorkerManager } from './WorkerManager'

<WorkerManager 
  fenceId={123}
  fenceName="Downtown"
  isOwner={true}
/>
```

**Bereits integriert in:** `FencePanel.jsx`

---

### 2. **PublicFenceList.jsx**
Liste aller öffentlichen Fences mit Worker-Info.

**Features:**
- Zeigt alle Fences mit Worker-Count und Contributors
- Expandable Details pro Fence
- Worker direkt aus der Liste zuweisen/entfernen
- Hebt eigene Worker-Zuweisungen hervor (grüner Hintergrund)
- Auto-Refresh alle 30 Sekunden

**Verwendung:**
```jsx
import { PublicFenceList } from './PublicFenceList'

<PublicFenceList />
```

**Integration-Vorschlag:**
- Als Sidebar-Panel neben der Map
- Oder als Modal/Dialog über Button in der Navbar

---

### 3. **WorkerStatsWidget.jsx**
Kompaktes Widget für Worker-Übersicht (Bottom-Right).

**Features:**
- Fixed Position (bottom-right corner)
- Zeigt Worker-Auslastung mit Progress Bar
- Expandable für Details aller Zuweisungen
- Farbcodierung (grün = verfügbar, orange = voll)
- Auto-Refresh alle 15 Sekunden

**Verwendung:**
```jsx
import { WorkerStatsWidget } from './WorkerStatsWidget'

// In deiner Main App Component:
<WorkerStatsWidget />
```

**Integration-Vorschlag:**
- In `src/App.jsx` oder `src/components/Layout.jsx` einbinden
- Immer sichtbar wenn User eingeloggt ist

---

## 🔌 Integration in bestehende App

### Option A: WorkerStatsWidget global einbinden

**In `src/App.jsx` oder ähnlich:**

```jsx
import { WorkerStatsWidget } from '@features/fence/WorkerStatsWidget'

function App() {
  return (
    <>
      {/* Deine bestehende App */}
      <Routes>
        {/* ... */}
      </Routes>
      
      {/* Worker Stats Widget - immer sichtbar */}
      <WorkerStatsWidget />
    </>
  )
}
```

### Option B: PublicFenceList als Sidebar

**Erstelle eine neue Sidebar-Komponente:**

```jsx
// src/components/FenceSidebar.jsx
import { Drawer, IconButton } from '@mui/material'
import { useState } from 'react'
import MapIcon from '@mui/icons-material/Map'
import { PublicFenceList } from '@features/fence/PublicFenceList'

export function FenceSidebar() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <IconButton 
        onClick={() => setOpen(true)}
        sx={{ position: 'fixed', top: 80, right: 10, zIndex: 1000 }}
      >
        <MapIcon />
      </IconButton>

      <Drawer
        anchor="right"
        open={open}
        onClose={() => setOpen(false)}
        sx={{ '& .MuiDrawer-paper': { width: 400 } }}
      >
        <PublicFenceList />
      </Drawer>
    </>
  )
}
```

### Option C: Als Modal/Dialog

```jsx
import { Dialog, Button } from '@mui/material'
import { PublicFenceList } from '@features/fence/PublicFenceList'

function FenceDialog() {
  const [open, setOpen] = useState(false)

  return (
    <>
      <Button onClick={() => setOpen(true)}>
        Fences anzeigen
      </Button>

      <Dialog 
        open={open} 
        onClose={() => setOpen(false)}
        maxWidth="sm"
        fullWidth
      >
        <PublicFenceList />
      </Dialog>
    </>
  )
}
```

---

## 🎯 Empfohlene Integration

### Schritt 1: WorkerStatsWidget einbinden

**In deiner Main-App-Komponente:**

```jsx
// src/App.jsx oder src/components/Layout.jsx
import { WorkerStatsWidget } from '@features/fence/WorkerStatsWidget'

// Irgendwo am Ende des JSX:
{isAuthenticated && <WorkerStatsWidget />}
```

### Schritt 2: Public Fence-Liste zugänglich machen

**Variante 1 - Button in Navbar:**

```jsx
// In deiner Navbar-Komponente
import { useState } from 'react'
import { Drawer, IconButton } from '@mui/material'
import MapIcon from '@mui/icons-material/Map'
import { PublicFenceList } from '@features/fence/PublicFenceList'

function Navbar() {
  const [fenceDrawerOpen, setFenceDrawerOpen] = useState(false)

  return (
    <>
      <AppBar>
        {/* ... andere Navbar-Items ... */}
        
        <IconButton 
          color="inherit"
          onClick={() => setFenceDrawerOpen(true)}
          title="Fences anzeigen"
        >
          <MapIcon />
        </IconButton>
      </AppBar>

      <Drawer
        anchor="right"
        open={fenceDrawerOpen}
        onClose={() => setFenceDrawerOpen(false)}
        sx={{ '& .MuiDrawer-paper': { width: 400, mt: 8 } }}
      >
        <PublicFenceList />
      </Drawer>
    </>
  )
}
```

**Variante 2 - Immer sichtbare Sidebar:**

```jsx
// In deiner Layout-Komponente
<Box sx={{ display: 'flex' }}>
  <Box sx={{ flex: 1 }}>
    {/* Hauptinhalt (Map, etc.) */}
  </Box>
  
  <Box sx={{ width: 400, borderLeft: '1px solid #ddd' }}>
    <PublicFenceList />
  </Box>
</Box>
```

---

## 📱 Responsive Design

Alle Komponenten sind responsive, aber für Mobile kannst du anpassen:

```jsx
import { useMediaQuery, useTheme } from '@mui/material'

function ResponsiveFenceList() {
  const theme = useTheme()
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'))

  return (
    <Drawer
      anchor={isMobile ? 'bottom' : 'right'}
      sx={{ 
        '& .MuiDrawer-paper': { 
          width: isMobile ? '100%' : 400,
          height: isMobile ? '80vh' : '100%'
        } 
      }}
    >
      <PublicFenceList />
    </Drawer>
  )
}
```

---

## 🎨 Styling-Anpassungen

Alle Komponenten nutzen Material-UI und können über `sx` Props angepasst werden:

```jsx
<WorkerManager 
  fenceId={123}
  fenceName="Downtown"
  sx={{ 
    border: '2px solid blue',
    borderRadius: 4,
    // ... custom styles
  }}
/>
```

---

## 🔄 State Management

Die Komponenten sind **selbstständig** und verwalten ihren eigenen State:
- Keine zusätzlichen Stores nötig
- Kommunizieren direkt mit Backend-APIs
- Auto-Refresh via `setInterval`

**Wenn du Zustand teilen möchtest:**

```jsx
// Erstelle einen Context
import { createContext, useContext, useState } from 'react'

const WorkerContext = createContext()

export function WorkerProvider({ children }) {
  const [stats, setStats] = useState(null)
  
  return (
    <WorkerContext.Provider value={{ stats, setStats }}>
      {children}
    </WorkerContext.Provider>
  )
}

export const useWorkerStats = () => useContext(WorkerContext)
```

---

## ✅ Checkliste für Integration

- [ ] SQL-Script in Koji-DB ausgeführt
- [ ] Server neu gestartet (Migration läuft automatisch)
- [ ] `WorkerManager` ist in `FencePanel` integriert ✅
- [ ] `WorkerStatsWidget` in Main-App eingebunden
- [ ] `PublicFenceList` zugänglich gemacht (Navbar/Sidebar/Modal)
- [ ] Testen: Worker zuweisen/entfernen
- [ ] Testen: Multi-User Collaboration
- [ ] Testen: Ownership-Transfer

---

## 🐛 Debugging

**Worker werden nicht angezeigt:**
```javascript
// Browser Console:
fetch('/api/v1/users/me/workers', { credentials: 'same-origin' })
  .then(r => r.json())
  .then(console.log)
```

**Fence-Liste leer:**
```javascript
fetch('/api/v1/users/fences/public')
  .then(r => r.json())
  .then(console.log)
```

**Worker-Zuweisung schlägt fehl:**
```javascript
fetch('/api/v1/users/fence/123/workers', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  credentials: 'same-origin',
  body: JSON.stringify({ workerDelta: 1 })
})
  .then(r => r.json())
  .then(console.log)
```

---

## 🚀 Fertig!

Alle UI-Komponenten sind erstellt und dokumentiert. Du kannst sie jetzt nach Bedarf in deine App integrieren!
