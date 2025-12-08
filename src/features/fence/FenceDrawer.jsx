// @ts-check
import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { useMap } from 'react-leaflet'
import L from 'leaflet'
import 'leaflet-draw'
import 'leaflet-geometryutil'
import 'leaflet-snap'
import * as turf from '@turf/helpers'
import distance from '@turf/distance'
import nearestPointOnLine from '@turf/nearest-point-on-line'

import { useLayoutStore } from '@store/useLayoutStore'
import { useMemory } from '@store/useMemory'
import { useStorage, useDeepStore } from '@store/useStorage'
import { FenceWorkerPopup } from './FenceWorkerPopup'

export function FenceDrawer() {
  const { t } = useTranslation()
  const map = useMap()
  const fenceOpen = useLayoutStore((s) => s.fence)
  const drawnItemsRef = React.useRef(null)
  const drawControlRef = React.useRef(null)
  const serverLoadedRef = React.useRef(false)
  const lastUserKeyRef = React.useRef('')
  const auth = useMemory((s) => s.auth)
  const hasFenceEditorPerm = useMemory((s) => s.auth?.perms?.fenceEditor)
  const hasPublicFencesPerm = useMemory((s) => s.auth?.perms?.publicFences)
  const didFitRef = React.useRef(false)
  const warnedRef = React.useRef(false)
  const spawnEnabled = useStorage((s) => !!s.filters?.spawnpoints?.enabled)
  const [spawnConfig, setSpawnConfig] = useDeepStore('filters.spawnpoints', {})
  const spawnAutoRef = React.useRef(false)
  const fenceAction = useLayoutStore((s) => s.fenceAction)
  const layerModifiedRef = React.useRef(false) // Track if layer was actually modified
  const attachLayerInteractionsRef = React.useRef(null) // Store the function for cross-useEffect access
  const [workerStats, setWorkerStats] = React.useState(null)
  const workerStatsRef = React.useRef(null)
  const [selectedFence, setSelectedFence] = React.useState(null) // Currently selected fence for worker management
  const selectedFenceRef = React.useRef(null)
  const [allFences, setAllFences] = React.useState([]) // All available fences with metadata
  const routeLayerRef = React.useRef(null) // FeatureGroup for Dragonite route overlay
  const routePolylineRef = React.useRef(null) // Active route polyline
  const blinkIntervalRef = React.useRef(null) // Interval for fence blinking

  const refreshWorkerStats = React.useCallback(() => {
    if (!auth?.loggedIn) {
      setWorkerStats(null)
      workerStatsRef.current = null
      return Promise.resolve(null)
    }
    return fetch('/api/v1/users/me/workers', { credentials: 'same-origin' })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        setWorkerStats(data || null)
        workerStatsRef.current = data || null
        return data || null
      })
      .catch((err) => {
        console.warn('FenceDrawer: Failed to load worker stats', err)
        return null
      })
  }, [auth?.loggedIn])

  // Refresh worker stats when other components change user worker allocations
  React.useEffect(() => {
    const handler = () => {
      try { refreshWorkerStats() } catch (_) {}
    }
    try { window.addEventListener('userWorkersChanged', handler) } catch (_) {}
    return () => {
      try { window.removeEventListener('userWorkersChanged', handler) } catch (_) {}
    }
  }, [refreshWorkerStats])

  const loadAllFences = React.useCallback(async () => {
    if (!auth?.loggedIn) return
    if (!hasPublicFencesPerm) return
    
    try {
      // Get map center for distance-based sorting
      const mapCenter = map.getCenter()
      const lat = mapCenter.lat
      const lng = mapCenter.lng
      
      // Load public fences metadata with distance sorting from server
      const publicRes = await fetch(
        `/api/v1/users/fences/public?lat=${lat}&lng=${lng}`, 
        { credentials: 'same-origin' }
      )
      if (!publicRes.ok) return
      
      const publicFences = await publicRes.json()
      setAllFences(publicFences)
      
      console.log('FenceDrawer: Loaded', publicFences.length, 'public fences metadata (sorted by distance from server)')
      
      // Clear and reload layers with ALL public fence geometries
      try { drawnItemsRef.current.clearLayers?.() } catch (_) {}
      
      // Load all public fence geometries
      publicFences.forEach((fence) => {
        try {
          const geometry = typeof fence.geometry === 'string' ? JSON.parse(fence.geometry) : fence.geometry
          if (!geometry) {
            console.warn('FenceDrawer: No geometry for fence', fence.id, fence.name)
            return
          }
          
          // Create GeoJSON layer for this fence
          const layer = L.geoJSON(geometry, {
            style: (feature) => {
              // Different styling for user's own fences vs others
              const isOwnFence = fence.owner === (auth.discordId || auth.telegramId || auth.username)
              return feature && feature.geometry && feature.geometry.type.includes('Polygon')
                ? { 
                    color: isOwnFence ? '#ff33aa' : '#3388ff', 
                    weight: isOwnFence ? 3 : 2, 
                    fillColor: isOwnFence ? '#ff33aa' : '#3388ff', 
                    fillOpacity: isOwnFence ? 0.15 : 0.1 
                  }
                : undefined
            },
          })
          
          layer.eachLayer((l) => {
            drawnItemsRef.current.addLayer(l)
            
            // Attach interactions for this fence
            if (attachLayerInteractionsRef.current && fence) {
              attachLayerInteractionsRef.current(l, fence)
            }
          })
          
          console.log('FenceDrawer: Added fence to map:', fence.name, 'Owner:', fence.owner, 'Own:', fence.owner === (auth.discordId || auth.telegramId || auth.username))
        } catch (e) {
          console.warn('FenceDrawer: Failed to add fence to map:', fence.id, fence.name, e)
        }
      })
      
      console.log('FenceDrawer: Successfully loaded all public fences on map')
    } catch (err) {
      console.warn('FenceDrawer: Failed to load fences', err)
    }
  }, [auth?.loggedIn, auth?.discordId, auth?.telegramId, auth?.username])

  React.useEffect(() => {
    if (!map) return

    console.log('FenceDrawer: map available, fenceOpen:', fenceOpen)

    // Ensure a FeatureGroup exists to hold any fences
    if (!drawnItemsRef.current) {
      drawnItemsRef.current = new L.FeatureGroup()
      map.addLayer(drawnItemsRef.current)
      console.log('FenceDrawer: Created FeatureGroup')
    }

    // Ensure a FeatureGroup exists for Dragonite route overlay
    if (!routeLayerRef.current) {
      routeLayerRef.current = new L.FeatureGroup()
      map.addLayer(routeLayerRef.current)
      try { routeLayerRef.current.bringToFront?.() } catch (_) {}
      console.log('FenceDrawer: Created Route FeatureGroup')
    }

    // Ensure a custom pane for dragonite route to draw above polygons
    try {
      let pane = map.getPane('dragoniteRoutePane')
      if (!pane) {
        pane = map.createPane('dragoniteRoutePane')
      }
      if (pane && pane.style) {
        // higher than overlayPane(400) but below markerPane(600)
        pane.style.zIndex = '550'
        pane.style.pointerEvents = 'none'
      }
    } catch (_) {}

    if (fenceOpen && !drawControlRef.current) {
      // Auto-disable spawnpoints when entering Fence mode to declutter editor by default
      try {
        if (spawnEnabled) {
          setSpawnConfig((prev) => ({ ...(prev || {}), enabled: false }))
          spawnAutoRef.current = true
        } else {
          spawnAutoRef.current = false
        }
      } catch (_) {}
      if (auth?.loggedIn) {
        refreshWorkerStats()
      }
      if (!auth?.loggedIn) {
        if (!warnedRef.current) {
          warnedRef.current = true
          try { window.alert('Bitte melde dich an, um Fences zu erstellen oder zu bearbeiten.') } catch (_) {}
        }
        return
      }
      if (!hasFenceEditorPerm) {
        if (!warnedRef.current) {
          warnedRef.current = true
          try { window.alert('Du hast keine Berechtigung, Fences zu erstellen oder zu bearbeiten.') } catch (_) {}
        }
        return
      }
      console.log('FenceDrawer: Initializing draw control')
      
      // Initialize the draw control with only polygon tool
      drawControlRef.current = new L.Control.Draw({
        position: 'topright',
        draw: {
          polyline: false,
          circle: false,
          circlemarker: false,
          marker: false,
          rectangle: false, // Remove rectangle tool
          polygon: {
            allowIntersection: true,
            shapeOptions: {
              color: '#3388ff',
              weight: 3,
              fillColor: '#3388ff',
              fillOpacity: 0.2,
            },
            showArea: true,
            showLength: false, // Disable length display
            metric: true,
            repeatMode: false,
            // Unlimited points
            maxPoints: 0,
          },
        },
        edit: {
          featureGroup: drawnItemsRef.current,
          remove: true,
          edit: {
            selectedPathOptions: {
              color: '#ff0000',
              weight: 3,
              opacity: 0.8,
            },
          },
        },
      })

      // Add control so handlers are fully initialized, then hide the UI container
      try { map.addControl(drawControlRef.current) } catch (_) {}
      try {
        const c = drawControlRef.current && drawControlRef.current._container
        if (c && c.style) c.style.display = 'none'
      } catch (_) {}
      console.log('FenceDrawer: Draw control initialized and hidden')

      // If a panel action was queued before init, process it now
      try {
        const pending = useLayoutStore.getState().fenceAction
        if (pending) {
          const tb = drawControlRef.current && drawControlRef.current._toolbars
          const drawHandler = tb?.draw?._modes?.polygon?.handler
          const editHandler = tb?.edit?._modes?.edit?.handler
          if (pending === 'draw') {
            if (!auth?.loggedIn) { try { window.alert(t('login_required_draw', 'Bitte melde dich an, um zu zeichnen.')) } catch (_) {} }
            try { editHandler?.disable?.() } catch (_) {}
            try { drawHandler?.enable?.() } catch (_) {}
          } else if (pending === 'edit') {
            if (!auth?.loggedIn) { try { window.alert(t('login_required_edit', 'Bitte melde dich an, um zu bearbeiten.')) } catch (_) {} }
            try { drawHandler?.disable?.() } catch (_) {}
            try { editHandler?.enable?.() } catch (_) {}
          } else if (pending === 'cancel') {
            // Explicit cancel queued before init: just ensure all handlers are disabled
            try { drawHandler?.disable?.() } catch (_) {}
            try { editHandler?.disable?.() } catch (_) {}
            layerModifiedRef.current = false
          }
          useLayoutStore.setState({ fenceAction: '' })
        }
      } catch (_) {}

      // Helper to attach click-to-focus interaction
      const attachLayerInteractions = (l, fenceData) => {
        try {
          // ensure layer is clickable
          try { if (l && l.options) l.options.interactive = true } catch (_) {}
          try { l.getElement && l.getElement()?.style && (l.getElement().style.pointerEvents = 'auto') } catch (_) {}
          
          // Store fence data on layer for later retrieval
          if (fenceData) {
            l.fenceData = fenceData
          }
          
          l.on('click', (e) => {
            // Stop propagation to prevent map click
            if (e && e.originalEvent) {
              e.originalEvent.stopPropagation()
              e.originalEvent.preventDefault()
            }
            
            if (!auth?.loggedIn) {
              try { window.alert(t('login_required_manage_fences', 'Bitte melde dich an, um Fences zu verwalten.')) } catch (_) {}
              return
            }
            
            // Check if we're in edit mode
            const currentFenceAction = useLayoutStore.getState().fenceAction
            const data = l.fenceData || fenceData
            
            if (currentFenceAction === 'edit') {
              // If clicking on the SAME fence being edited -> Save and exit edit mode
              if (selectedFenceRef.current && selectedFenceRef.current.id === data?.id) {
                console.log('FenceDrawer: Saving fence on click (same fence)')
                
                // Save current fence
                const geoJSON = l.toGeoJSON()
                
                fetch(`/api/v1/users/geofence/${data.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'same-origin',
                  body: JSON.stringify({ 
                    geometry: geoJSON.geometry,
                  }),
                })
                  .then(async (res) => {
                    if (res.ok) {
                      console.log('FenceDrawer: Fence gespeichert')
                      try { 
                        window.alert(`Fence "${data.name}" erfolgreich gespeichert!`) 
                      } catch (_) {}
                    } else {
                      throw new Error('Speichern fehlgeschlagen')
                    }
                  })
                  .catch((err) => {
                    console.error('FenceDrawer: Speichern fehlgeschlagen', err)
                    try { 
                      window.alert('Fehler beim Speichern: ' + err.message) 
                    } catch (_) {}
                  })
                
                // Exit edit mode BEFORE continuing - this ensures fenceAction is no longer 'edit'
                // so the worker popup will be shown
                useLayoutStore.setState({ fenceAction: '' })
                layerModifiedRef.current = false
                
                // Continue to focus the fence and show worker popup
                // Don't return - let the code below execute
              }
              
              // If clicking on a DIFFERENT fence -> Ask to save
              if (selectedFenceRef.current && selectedFenceRef.current.id !== data?.id) {
                // Ask if user wants to save changes
                const shouldSave = window.confirm('Möchtest du die Änderungen an der aktuellen Fence speichern?')
                
                if (shouldSave) {
                  // Save current fence
                  const currentLayers = drawnItemsRef.current.getLayers()
                  currentLayers.forEach((layer) => {
                    if (layer.fenceData?.id === selectedFenceRef.current.id) {
                      const geoJSON = layer.toGeoJSON()
                      
                      fetch(`/api/v1/users/geofence/${selectedFenceRef.current.id}`, {
                        method: 'PUT',
                        headers: { 'Content-Type': 'application/json' },
                        credentials: 'same-origin',
                        body: JSON.stringify({ 
                          geometry: geoJSON.geometry,
                        }),
                      })
                        .then(async (res) => {
                          if (res.ok) {
                            console.log('FenceDrawer: Fence gespeichert')
                          }
                        })
                        .catch((err) => {
                          console.error('FenceDrawer: Speichern fehlgeschlagen', err)
                        })
                    }
                  })
                }
                
                // Exit edit mode
                useLayoutStore.setState({ fenceAction: 'stop' })
                layerModifiedRef.current = false
              }
            }
            
            // Focus this fence for worker management
            console.log('FenceDrawer: Fence clicked!')
            console.log('  - Layer fenceData:', l.fenceData)
            console.log('  - Passed fenceData:', fenceData)
            console.log('  - Using data:', data)
            console.log('  - Fence ID:', data?.id, 'Name:', data?.name)
            
            if (!data) {
              console.error('FenceDrawer: No fence data available for clicked layer!')
              return
            }
            
            // Update selected fence
            setSelectedFence(data)
            selectedFenceRef.current = data
            
            // Dispatch event to notify FencePanel
            window.dispatchEvent(new CustomEvent('fenceFocused', { detail: data }))
            
            // Update visual styling - highlight selected fence
            drawnItemsRef.current.eachLayer((layer) => {
              if (layer === l) {
                // Selected fence - bright highlight
                layer.setStyle({
                  color: '#00ff00',
                  weight: 4,
                  fillColor: '#00ff00',
                  fillOpacity: 0.3
                })
              } else {
                // Other fences - dim them
                layer.setStyle({
                  color: '#ff33aa',
                  weight: 2,
                  fillColor: '#ff33aa',
                  fillOpacity: 0.1
                })
              }
            })
            
            // Fit bounds to selected fence
            try {
              const bounds = l.getBounds()
              if (bounds && bounds.isValid && bounds.isValid()) {
                map.fitBounds(bounds.pad(0.2))
              }
            } catch (err) {
              console.warn('FenceDrawer: Failed to fit bounds', err)
            }
          })
        } catch (err) {
          console.warn('FenceDrawer: attachLayerInteractions failed', err)
        }
      }
      
      // Store function in ref for cross-useEffect access
      attachLayerInteractionsRef.current = attachLayerInteractions

      // Helper: find layer by fence id
      const findLayerByFenceId = (fid) => {
        let target = null
        try {
          drawnItemsRef.current?.eachLayer?.((layer) => {
            if (!target && layer?.fenceData?.id === fid) target = layer
          })
        } catch (_) {}
        return target
      }

      // Listen for start/stop blink events from panel
      const onStartBlink = (e) => {
        const fid = e?.detail?.fenceId
        if (!fid) return
        const layer = findLayerByFenceId(fid)
        if (!layer) return
        // Clear previous
        if (blinkIntervalRef.current) {
          clearInterval(blinkIntervalRef.current)
          blinkIntervalRef.current = null
        }
        let on = false
        blinkIntervalRef.current = setInterval(() => {
          try {
            on = !on
            layer.setStyle({
              color: on ? '#ff9800' : '#00ff00',
              weight: on ? 5 : 4,
              fillColor: on ? '#ff9800' : '#00ff00',
              fillOpacity: on ? 0.35 : 0.25,
            })
          } catch (_) {}
        }, 700)
      }
      const onStopBlink = (e) => {
        const fid = e?.detail?.fenceId
        if (blinkIntervalRef.current) {
          clearInterval(blinkIntervalRef.current)
          blinkIntervalRef.current = null
        }
        // Restore highlight style for selected fence if provided
        const layer = fid ? findLayerByFenceId(fid) : null
        try {
          if (layer) {
            layer.setStyle({ color: '#00ff00', weight: 4, fillColor: '#00ff00', fillOpacity: 0.3 })
          }
        } catch (_) {}
      }
      try {
        window.addEventListener('startFenceBlink', onStartBlink)
        window.addEventListener('stopFenceBlink', onStopBlink)
      } catch (_) {}

      // Helper to render a full route polyline
      const renderRoute = (points) => {
        try {
          // Clear previous polyline
          if (routePolylineRef.current && routeLayerRef.current) {
            try { routeLayerRef.current.removeLayer(routePolylineRef.current) } catch (_) {}
            routePolylineRef.current = null
          }
          if (Array.isArray(points) && points.length >= 2 && routeLayerRef.current) {
            const latlngs = points.map((p) => [p.lat, p.lon])
            routePolylineRef.current = L.polyline(latlngs, { color: '#1976d2', weight: 3, opacity: 0.95, pane: 'dragoniteRoutePane' })
            routeLayerRef.current.addLayer(routePolylineRef.current)
            try { routeLayerRef.current.bringToFront?.() } catch (_) {}
            console.log('FenceDrawer: Rendered Dragonite route polyline, points:', points.length)
          }
        } catch (e) {
          console.warn('FenceDrawer: renderRoute failed', e)
        }
      }

      // Fetch and render route for given area id
      const fetchAndRenderRoute = async (areaId) => {
        if (!areaId) return
        try {
          const url = `/api/v1/area/dragonite/route/${encodeURIComponent(String(areaId))}`
          const res = await fetch(url, { credentials: 'same-origin' })
          if (!res.ok) {
            console.warn('FenceDrawer: route fetch non-OK', res.status, url)
            return renderRoute([])
          }
          const j = await res.json().catch(() => ({ points: [] }))
          const pts = Array.isArray(j?.points) ? j.points : []
          console.log('FenceDrawer: route points received:', pts.length)
          renderRoute(pts)
        } catch (e) {
          console.warn('FenceDrawer: fetch route failed', e)
          renderRoute([])
        }
      }

      // Event handlers
      const onDrawCreated = (e) => {
        console.log('FenceDrawer: Draw created event', e.layerType)
        const layer = e.layer
        // keep existing fences when adding a new one
        drawnItemsRef.current.addLayer(layer)
        // DON'T attach interactions yet - wait until after name prompt and save
        layerModifiedRef.current = true // Mark as modified
        // disable drawing further fences until deletion
        try {
          const drawToolbar = drawControlRef.current && drawControlRef.current._toolbars && drawControlRef.current._toolbars.draw
          const polygonMode = drawToolbar && drawToolbar._modes && drawToolbar._modes.polygon
          polygonMode && polygonMode.handler && polygonMode.handler.disable && polygonMode.handler.disable()
        } catch (_) {}
        
        const geoJSON = layer.toGeoJSON()
        console.log('Fence created:', geoJSON)
        
        const name = window.prompt(t('prompt_fence_name', 'Bitte Namen für die Fence eingeben:'), '') || ''
        if (!name) {
          console.warn('FenceDrawer: No name provided, removing layer')
          try { drawnItemsRef.current.removeLayer(layer) } catch (_) {}
          layerModifiedRef.current = false // Reset flag since we're not saving
          // Re-enable drawing
          try {
            const drawToolbar = drawControlRef.current && drawControlRef.current._toolbars && drawControlRef.current._toolbars.draw
            const polygonMode = drawToolbar && drawToolbar._modes && drawToolbar._modes.polygon
            polygonMode && polygonMode.handler && polygonMode.handler.enable && polygonMode.handler.enable()
          } catch (_) {}
          return
        }

        // Backend macht ALLES (Koji + Dragonite synchron)
        fetch('/api/v1/users/geofence', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ name, geometry: geoJSON.geometry, mode: 'auto_quest' }),
        })
          .then(async (res) => {
            if (!res.ok) {
              if (res.status === 401 || res.status === 403) {
                try { window.alert(t('login_required_save_fence', 'Bitte melde dich an, um Fences zu speichern.')) } catch (_) {}
                throw new Error('Nicht angemeldet')
              }
              // Try to parse error response
              try {
                const errorData = await res.json()
                if (errorData.reason) {
                  try { window.alert(errorData.reason) } catch (_) {}
                  throw new Error(errorData.reason)
                }
              } catch (jsonErr) {
                // Fallback to text
                const txt = await res.text().catch(() => '')
                throw new Error(txt || t('error_saving_fence', 'Fehler beim Speichern der Fence'))
              }
            }
            return res.json()
          })
          .then((data) => {
            console.log('FenceDrawer: Fence erfolgreich gespeichert', data)
            // Save dragoniteId to localStorage
            if (data.dragoniteId) {
              localStorage.setItem('dragoniteAreaId', String(data.dragoniteId))
            }
            // Show warning if partial success
            if (data.status === 'partial') {
              try { window.alert(data.message || 'Warnung: Synchronisation teilweise fehlgeschlagen') } catch (_) {}
            }
            // Reload areas
            fetch('/api/v1/area/reload', { method: 'GET', credentials: 'same-origin' }).catch(() => {})
            refreshWorkerStats()

            // Automatically trigger Dragonite bootstrap exploration for the new area
            try {
              if (data?.dragoniteId) {
                const areaId = String(data.dragoniteId)
                console.log('FenceDrawer: Auto-starting Dragonite bootstrap for area', areaId)
                fetch(`/api/v1/area/dragonite/recalculate/${encodeURIComponent(areaId)}?bootstrap=true`).catch(() => {})
                fetch('/api/v1/area/dragonite/reload').catch(() => {})
                // Notify UI that bootstrap was started so it can present progress/ETA
                try { window.dispatchEvent(new CustomEvent('autoBootstrapStarted', { detail: { dragoniteAreaId: areaId } })) } catch (_) {}
              }
            } catch (_) {}

            // Reload fences from server to ensure consistency
            setTimeout(() => {
              loadAllFences()
            }, 500)
          })
          .catch((err) => {
            console.error('FenceDrawer: Speichern fehlgeschlagen', err)
            try { window.alert(t('error_saving_fence_with_message', 'Fehler beim Speichern der Fence: {{msg}}', { msg: err.message })) } catch (_) {}
          })
      }

      // Suppress double-click finishing while drawing polygon
      const suppressDblClick = (e) => {
        if (e && e.originalEvent) {
          e.originalEvent.preventDefault()
          e.originalEvent.stopPropagation()
        }
      }

      const onDrawStart = (e) => {
        if (e.layerType === 'polygon') {
          console.log('FenceDrawer: Polygon draw started, suppressing dblclick finish')
          map.on('dblclick', suppressDblClick)

          try {
            const drawToolbar = drawControlRef.current && drawControlRef.current._toolbars && drawControlRef.current._toolbars.draw
            const polygonHandler = drawToolbar && drawToolbar._modes && drawToolbar._modes.polygon && drawToolbar._modes.polygon.handler
            if (polygonHandler) {
              const available = workerStatsRef.current?.available
              if (available !== undefined && available <= 0) {
                console.log('FenceDrawer: No available workers, disabling draw')
                polygonHandler.disable()
                map.off('dblclick', suppressDblClick)
                try { window.alert(t('no_workers_available', 'Keine freien Worker verfügbar. Entferne Worker oder lösche eine Fence, um fortzufahren.')) } catch (_) {}
                return
              }
              const limit = workerStatsRef.current?.total
              if (limit && limit > 0) {
                const userKey = auth?.discordId || auth?.telegramId || auth?.username
                const layers = drawnItemsRef.current && drawnItemsRef.current.getLayers ? drawnItemsRef.current.getLayers() : []
                const ownCount = layers.filter((layer) => {
                  try {
                    return layer?.fenceData && layer.fenceData.owner === userKey
                  } catch (_) {
                    return false
                  }
                }).length
                if (ownCount >= limit) {
                  console.log('FenceDrawer: Reached fence limit, disabling draw')
                  polygonHandler.disable()
                  map.off('dblclick', suppressDblClick)
                  try { window.alert(t('fence_limit_reached', 'Du kannst maximal {{limit}} Fences erstellen. Entferne eine vorhandene Fence, um eine neue zu zeichnen.', { limit })) } catch (_) {}
                  return
                }
              }
              // Force unlimited vertices defensively
              if (polygonHandler.options) polygonHandler.options.maxPoints = 0
              polygonHandler._maxPoints = Infinity
              console.log('FenceDrawer: Ensured unlimited points on polygon handler')

              // Prepare default snapping configuration for drawing along existing fence edges
              try {
                polygonHandler._rmSnapDistanceMeters = 200 // 200 meters snap radius
              } catch (_) {}
              
              console.log('FenceDrawer: Geographic snap enabled (200m radius)')

              // Attach snap for the live cursor marker using GeometryUtil directly
              try {
                const buildGuideLayers = () => {
                  const guides = []
                  try {
                    drawnItemsRef.current?.eachLayer?.((l) => {
                      if (l && typeof l.getLatLngs === 'function') {
                        guides.push(l)
                        try {
                          const rings = l.getLatLngs()
                          const flat = Array.isArray(rings) ? rings : []
                          const all = flat.flat(2)
                          if (Array.isArray(all) && all.length > 1) {
                            const pl = L.polyline(all)
                            guides.push(pl)
                          }
                        } catch (_) {}
                      } else if (l && typeof l.getPaths === 'function') {
                        guides.push(l)
                      }
                    })
                  } catch (_) {}
                  return guides
                }
                
                // Attach continuous snapping to map mousemove during drawing
                const snapOnMove = (e) => {
                  try {
                    if (!polygonHandler || !polygonHandler._enabled) return
                    const guides = buildGuideLayers()
                    if (guides.length === 0) return
                    const snapDistMeters = polygonHandler._rmSnapDistanceMeters || 200
                    
                    const point = turf.point([e.latlng.lng, e.latlng.lat])
                    let closestSnap = null
                    let minDist = Infinity
                    
                    guides.forEach((layer) => {
                      try {
                        if (typeof layer.getLatLngs === 'function') {
                          const latlngs = layer.getLatLngs()
                          const coords = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs
                          if (coords.length > 1) {
                            const lineCoords = coords.map(ll => [ll.lng, ll.lat])
                            const line = turf.lineString(lineCoords)
                            const nearest = nearestPointOnLine(line, point, { units: 'meters' })
                            const dist = distance(point, nearest, { units: 'meters' })
                            if (dist < minDist && dist <= snapDistMeters) {
                              minDist = dist
                              closestSnap = { lat: nearest.geometry.coordinates[1], lng: nearest.geometry.coordinates[0] }
                            }
                          }
                        }
                      } catch (_) {}
                    })
                    
                    if (closestSnap && polygonHandler._marker) {
                      console.log('FenceDrawer: Snapped cursor to', closestSnap, 'distance:', minDist.toFixed(1), 'm')
                      polygonHandler._marker.setLatLng(closestSnap)
                    }
                  } catch (err) {
                    console.warn('FenceDrawer: snapOnMove error', err)
                  }
                }
                map.on('mousemove', snapOnMove)
                polygonHandler._rmSnapMoveHandler = snapOnMove
              } catch (_) {}
            }
          } catch (err) {
            console.warn('FenceDrawer: onDrawStart handler setup error', err)
          }
        }
      }

      const onDrawStop = (e) => {
        if (e.layerType === 'polygon') {
          console.log('FenceDrawer: Polygon draw stopped, restoring dblclick')
          map.off('dblclick', suppressDblClick)
          // Remove snap mousemove handler
          try {
            const drawToolbar = drawControlRef.current && drawControlRef.current._toolbars && drawControlRef.current._toolbars.draw
            const polygonHandler = drawToolbar && drawToolbar._modes && drawToolbar._modes.polygon && drawToolbar._modes.polygon.handler
            if (polygonHandler && polygonHandler._rmSnapMoveHandler) {
              map.off('mousemove', polygonHandler._rmSnapMoveHandler)
              polygonHandler._rmSnapMoveHandler = null
            }
          } catch (_) {}
        }
      }

      // While drawing a polygon, allow finishing by clicking the first vertex
      const onDrawVertex = (e) => {
        console.log('FenceDrawer: onDrawVertex called!')
        try {
          const drawToolbar = drawControlRef.current && drawControlRef.current._toolbars && drawControlRef.current._toolbars.draw
          const polygonHandler = drawToolbar && drawToolbar._modes && drawToolbar._modes.polygon && drawToolbar._modes.polygon.handler
          if (!polygonHandler) {
            console.log('FenceDrawer: onDrawVertex - no polygonHandler')
            return
          }

          // Only handle if we're actively drawing (handler is enabled)
          if (!polygonHandler._enabled) {
            console.log('FenceDrawer: onDrawVertex - handler not enabled')
            return
          }

          // We always attach snapping for available markers (even with <3 markers)
          const hasHandlerMarkers = Array.isArray(polygonHandler._markers) ? polygonHandler._markers.length : 0
          console.log('FenceDrawer: onDrawVertex - attaching snap, handler markers:', hasHandlerMarkers)

          const layers = e.layers
          const markers = layers && typeof layers.getLayers === 'function' ? layers.getLayers() : []
          console.log('FenceDrawer: drawvertex markers count:', markers.length, 'handler markers:', polygonHandler._markers.length)
          if (markers.length < 1) {
            // still proceed with handler markers for snap
          }

          const first = markers[0]
          // Remove ALL previous click handlers to avoid conflicts
          if (first && first.off && first.on) {
            first.off('click')
            // Add new click handler that finishes the shape
            first.on('click', (clickEvent) => {
              console.log('FenceDrawer: First vertex clicked, stopping propagation')
              // Stop ALL event propagation
              if (clickEvent) {
                clickEvent.stopPropagation?.()
                if (clickEvent.originalEvent) {
                  clickEvent.originalEvent.stopPropagation?.()
                  clickEvent.originalEvent.preventDefault?.()
                }
              }
              if (polygonHandler && polygonHandler._enabled && polygonHandler._markers && polygonHandler._markers.length > 2) {
                console.log('FenceDrawer: Finishing polygon by clicking first vertex')
                polygonHandler._finishShape()
              } else {
                console.warn('FenceDrawer: Cannot finish - conditions not met', {
                  hasHandler: !!polygonHandler,
                  enabled: polygonHandler?._enabled,
                  markerCount: polygonHandler?._markers?.length
                })
              }
            })
          }

          // Enable snapping for all current draw markers against existing fence layers (edges)
          try {
            const guideLayers = []
            try {
              drawnItemsRef.current?.eachLayer?.((l) => {
                if (l && typeof l.getLatLngs === 'function') {
                  // use original layer
                  guideLayers.push(l)
                  // also add explicit edge polylines for each ring to improve edge snapping
                  try {
                    const rings = l.getLatLngs()
                    const flat = Array.isArray(rings) ? rings : []
                    const all = flat.flat(2)
                    if (Array.isArray(all) && all.length > 1) {
                      const pl = L.polyline(all)
                      guideLayers.push(pl)
                    }
                  } catch (_) {}
                } else if (l && typeof l.getPaths === 'function') {
                  guideLayers.push(l)
                }
              })
            } catch (_) {}
            try { console.log('FenceDrawer: guideLayers for draw:', guideLayers.length) } catch (_) {}
            
            // Filter out the currently drawn polygon from guide layers
            const currentPolyLayer = polygonHandler && polygonHandler._poly
            const filteredGuideLayers = guideLayers.filter(layer => layer !== currentPolyLayer)
            console.log('FenceDrawer: Filtered guideLayers (excluding current):', filteredGuideLayers.length)

            const attachSnap = (m) => {
              try {
                if (!m || m._rmSnapAttached) return
                m._rmSnapAttached = true
                const snapDistMeters = polygonHandler._rmSnapDistanceMeters || 200
                
                const snapToNearestEdge = (markerLatLng) => {
                  try {
                    const point = turf.point([markerLatLng.lng, markerLatLng.lat])
                    let closestSnap = null
                    let minDist = Infinity
                    
                    filteredGuideLayers.forEach((layer) => {
                      try {
                        if (typeof layer.getLatLngs === 'function') {
                          const latlngs = layer.getLatLngs()
                          const coords = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs
                          if (coords.length > 1) {
                            // Check distance to each vertex (corner point) - prioritize vertices with smaller radius
                            const vertexSnapDist = Math.min(snapDistMeters, 50) // Max 50m for vertices
                            coords.forEach((coord) => {
                              try {
                                const vertexPoint = turf.point([coord.lng, coord.lat])
                                const dist = distance(point, vertexPoint, { units: 'meters' })
                                // Vertices get priority by reducing their effective distance
                                const effectiveDist = dist * 0.5 // Vertices are "twice as attractive"
                                if (effectiveDist < minDist && dist <= vertexSnapDist) {
                                  minDist = effectiveDist
                                  closestSnap = { lat: coord.lat, lng: coord.lng }
                                }
                              } catch (_) {}
                            })
                            
                            // Also check distance to edges (lines between vertices)
                            const lineCoords = coords.map(ll => [ll.lng, ll.lat])
                            const line = turf.lineString(lineCoords)
                            const nearest = nearestPointOnLine(line, point, { units: 'meters' })
                            const dist = distance(point, nearest, { units: 'meters' })
                            if (dist < minDist && dist <= snapDistMeters) {
                              minDist = dist
                              closestSnap = { lat: nearest.geometry.coordinates[1], lng: nearest.geometry.coordinates[0] }
                            }
                          }
                        }
                      } catch (_) {}
                    })
                    
                    if (closestSnap) {
                      console.log('FenceDrawer: Snap vertex to', closestSnap, 'distance:', minDist.toFixed(1), 'm')
                      return closestSnap
                    }
                    return null
                  } catch (err) {
                    console.warn('FenceDrawer: snapToNearestEdge error', err)
                    return null
                  }
                }
                
                // Initial snap to nearest edge
                try {
                  const snap = snapToNearestEdge(m.getLatLng())
                  if (snap) {
                    m.setLatLng(snap)
                    // Update the actual latlng in the polygon handler's internal array
                    try {
                      if (polygonHandler && polygonHandler._markers) {
                        const idx = polygonHandler._markers.indexOf(m)
                        if (idx !== -1 && polygonHandler._poly && polygonHandler._poly._latlngs) {
                          polygonHandler._poly._latlngs[idx] = L.latLng(snap.lat, snap.lng)
                        }
                      }
                    } catch (_) {}
                    // Force polygon handler to update the shape with new marker position
                    try {
                      if (polygonHandler && polygonHandler._poly) {
                        polygonHandler._poly.redraw()
                      }
                    } catch (_) {}
                  } else {
                    console.log('FenceDrawer: No snap found (>200m from edges)')
                  }
                } catch (err) {
                  console.error('FenceDrawer: Initial snap error', err)
                }
                
                // Continuous snapping while dragging
                try {
                  m.off('drag')
                  m.on('drag', () => {
                    try {
                      const snap = snapToNearestEdge(m.getLatLng())
                      if (snap) {
                        m.setLatLng(snap)
                        // Update the actual latlng in the polygon handler's internal array
                        try {
                          if (polygonHandler && polygonHandler._markers) {
                            const idx = polygonHandler._markers.indexOf(m)
                            if (idx !== -1 && polygonHandler._poly && polygonHandler._poly._latlngs) {
                              polygonHandler._poly._latlngs[idx] = L.latLng(snap.lat, snap.lng)
                            }
                          }
                        } catch (_) {}
                        // Force polygon handler to update the shape with new marker position
                        try {
                          if (polygonHandler && polygonHandler._poly) {
                            polygonHandler._poly.redraw()
                          }
                        } catch (_) {}
                      }
                    } catch (err2) {
                      console.warn('FenceDrawer: Drag snap error', err2)
                    }
                  })
                } catch (err3) {
                  console.warn('FenceDrawer: Drag handler attach error', err3)
                }
              } catch (err4) {
                console.warn('FenceDrawer: attachSnap error', err4)
              }
            }

            // Attach to all known handler markers
            try { polygonHandler._markers?.forEach?.(attachSnap) } catch (_) {}
            try { markers.forEach?.(attachSnap) } catch (_) {}
            try { if (polygonHandler._marker) attachSnap(polygonHandler._marker) } catch (_) {}
          } catch (err) {
            console.warn('FenceDrawer: Failed to attach snap to draw markers', err)
          }
        } catch (err) {
          console.warn('FenceDrawer: onDrawVertex error', err)
        }
      }

      const onDrawEdited = (e) => {
        const layers = e.layers
        console.log('FenceDrawer: Draw edited, layers count:', layers.getLayers().length)
        layerModifiedRef.current = true // Mark as modified
        layers.eachLayer((layer) => {
          const geoJSON = layer.toGeoJSON()
          console.log('Fence edited:', geoJSON)
          
          // Backend macht ALLES (Koji + Dragonite synchron)
          const dragoniteAreaId = localStorage.getItem('dragoniteAreaId')
          fetch('/api/v1/users/geofence', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ 
              geometry: geoJSON.geometry,
              dragoniteAreaId: dragoniteAreaId || undefined
            }),
          })
            .then(async (res) => {
              if (!res.ok) {
                if (res.status === 401 || res.status === 403) {
                  try { window.alert('Bitte melde dich an, um Fences zu bearbeiten.') } catch (_) {}
                }
                const t = await res.text().catch(() => '')
                throw new Error(t || 'Fehler beim Aktualisieren der Fence')
              }
              return res.json()
            })
            .then((data) => {
              console.log('FenceDrawer: Fence erfolgreich aktualisiert', data)
              // Update dragoniteId in localStorage
              if (data.dragoniteId) {
                localStorage.setItem('dragoniteAreaId', String(data.dragoniteId))
              }
              // Show warning if partial success
              if (data.status === 'partial') {
                try { window.alert(data.message || 'Warnung: Synchronisation teilweise fehlgeschlagen') } catch (_) {}
              }
              // Reload areas
              fetch('/api/v1/area/reload', { method: 'GET', credentials: 'same-origin' }).catch(() => {})
              
              // Reload fences from server to ensure consistency
              setTimeout(() => {
                loadAllFences()
              }, 500)
            })
            .catch((err) => {
              console.error('FenceDrawer: Aktualisieren fehlgeschlagen', err)
              try { window.alert('Fehler beim Aktualisieren der Fence: ' + err.message) } catch (_) {}
            })
        })
        refreshWorkerStats()
      }

      const onDrawDeleted = (e) => {
        console.log('FenceDrawer: Draw deleted')
        if (!auth?.loggedIn) {
          try { window.alert(t('login_required_delete_fences', 'Bitte melde dich an, um Fences zu löschen.')) } catch (_) {}
          return
        }
        // Purge all of the user's fences in Dragonite and Koji
        fetch('/api/v1/users/geofence', {
          method: 'DELETE',
          credentials: 'same-origin',
        })
          .then(async (res) => {
            if (!res.ok && (res.status === 401 || res.status === 403)) {
              try { window.alert(t('login_required_delete_fences', 'Bitte melde dich an, um Fences zu löschen.')) } catch (_) {}
            }
            if (!res.ok) {
              const t = await res.text().catch(() => '')
              throw new Error(t || 'Fence purge failed')
            }
            const data = await res.json().catch(() => ({}))
            console.log('FenceDrawer: Fence erfolgreich gelöscht', data)
            
            // Show warning if partial success
            if (data.status === 'partial') {
              try { window.alert(data.message || 'Warnung: Synchronisation teilweise fehlgeschlagen') } catch (_) {}
            }
            
            localStorage.removeItem('dragoniteAreaId')
            localStorage.removeItem('userFences')
            
            // CRITICAL: Clear ALL layers to ensure clean state
            try { drawnItemsRef.current.clearLayers?.() } catch (_) {}
            
            // CRITICAL: Reset ALL ref flags to force clean state
            layerModifiedRef.current = false
            serverLoadedRef.current = false
            didFitRef.current = false
            lastUserKeyRef.current = ''
            
            // CRITICAL: Clear fenceAction to prevent stale actions
            useLayoutStore.setState({ fenceAction: '' })
            
            // After purge, reload app areas
            try { await fetch('/api/v1/area/reload', { method: 'GET', credentials: 'same-origin' }) } catch (_) {}
            
            // Force complete reload by closing fence mode
            console.log('FenceDrawer: Closing fence mode to force clean state')
            useLayoutStore.setState({ fence: false })
            
            // Show alert that user needs to reopen
            setTimeout(() => {
              try {
                window.alert('Fence gelöscht! Bitte öffne den Fence-Modus erneut um eine neue Fence zu zeichnen.')
              } catch (_) {}
            }, 200)
            refreshWorkerStats()
          })
          .catch((err) => {
            console.error('FenceDrawer: purge failed', err)
            try { window.alert('Fehler beim Löschen der Fence: ' + err.message) } catch (_) {}
          })
      }

      // Remove old handlers first to avoid duplicates
      map.off(L.Draw.Event.CREATED, onDrawCreated)
      map.off(L.Draw.Event.DRAWSTART, onDrawStart)
      map.off(L.Draw.Event.DRAWSTOP, onDrawStop)
      map.off(L.Draw.Event.DRAWVERTEX, onDrawVertex)
      map.off(L.Draw.Event.EDITED, onDrawEdited)
      map.off(L.Draw.Event.DELETED, onDrawDeleted)
      
      // Register handlers
      map.on(L.Draw.Event.CREATED, onDrawCreated)
      map.on(L.Draw.Event.DRAWSTART, onDrawStart)
      map.on(L.Draw.Event.DRAWSTOP, onDrawStop)
      map.on(L.Draw.Event.DRAWVERTEX, onDrawVertex)
      map.on(L.Draw.Event.EDITED, onDrawEdited)
      map.on(L.Draw.Event.DELETED, onDrawDeleted)
      
      console.log('FenceDrawer: Event handlers registered')

      // Listen for fence focus to show Dragonite route as full polyline
      const onFenceFocused = (e) => {
        try {
          const fence = e?.detail
          const areaId = fence?.dragoniteAreaId
          console.log('FenceDrawer: onFenceFocused -> fetching Dragonite route for area', areaId)
          fetchAndRenderRoute(areaId)
        } catch (err) {
          console.warn('FenceDrawer: onFenceFocused failed', err)
        }
      }
      window.addEventListener('fenceFocused', onFenceFocused)

      // Load saved fences
      const savedFences = JSON.parse(localStorage.getItem('userFences') || '[]')
      console.log('FenceDrawer: Loading saved fences:', savedFences.length)
      savedFences.forEach((fence) => {
        const layer = L.geoJSON(fence.data)
        layer.eachLayer((l) => {
          drawnItemsRef.current.addLayer(l)
          attachLayerInteractions(l)
        })
      })

      // Server fences werden im separaten useEffect geladen (siehe unten)

      return () => {
        // Cleanup: Event Listeners entfernen
        // Auto-save wird jetzt im separaten useEffect gemacht (siehe unten)
        map.off(L.Draw.Event.CREATED, onDrawCreated)
        map.off(L.Draw.Event.DRAWSTART, onDrawStart)
        map.off(L.Draw.Event.DRAWSTOP, onDrawStop)
        map.off(L.Draw.Event.DRAWVERTEX, onDrawVertex)
        map.off(L.Draw.Event.EDITED, onDrawEdited)
        map.off(L.Draw.Event.DELETED, onDrawDeleted)
        map.off('dblclick', suppressDblClick)
        try { window.removeEventListener('fenceFocused', onFenceFocused) } catch (_) {}
        // Clear route overlay
        try {
          if (routeLayerRef.current) {
            routeLayerRef.current.clearLayers?.()
          }
          routePolylineRef.current = null
        } catch (_) {}
      }
    }
  }, [map, fenceOpen, spawnEnabled, refreshWorkerStats])

  // Listen for external focus requests from other UI (e.g., PublicFenceList)
  React.useEffect(() => {
    if (!map) return
    const onExternalFocus = (e) => {
      try {
        const fence = e?.detail
        if (!fence) return

        // Try to find existing layer for this fence to highlight and get bounds
        let targetLayer = null
        try {
          drawnItemsRef.current?.eachLayer?.((layer) => {
            if (layer?.fenceData?.id === fence.id) {
              targetLayer = layer
            }
          })
        } catch (_) {}

        // Highlight selection styling if layer found
        if (targetLayer) {
          try {
            drawnItemsRef.current.eachLayer((layer) => {
              if (layer === targetLayer) {
                layer.setStyle?.({ color: '#00ff00', weight: 4, fillColor: '#00ff00', fillOpacity: 0.3 })
              } else {
                layer.setStyle?.({ color: '#ff33aa', weight: 2, fillColor: '#ff33aa', fillOpacity: 0.1 })
              }
            })
          } catch (_) {}
        }

        // Compute bounds and focus map
        let bounds = null
        try {
          if (targetLayer && targetLayer.getBounds) {
            bounds = targetLayer.getBounds()
          } else if (fence?.geometry) {
            const layer = L.geoJSON(typeof fence.geometry === 'string' ? JSON.parse(fence.geometry) : fence.geometry)
            if (layer && layer.getBounds) bounds = layer.getBounds()
          }
        } catch (_) {}

        try {
          if (bounds && bounds.isValid && bounds.isValid()) {
            map.fitBounds(bounds.pad(0.2))
          } else if (fence?.geometry?.type === 'Point' && Array.isArray(fence.geometry.coordinates)) {
            const [lng, lat] = fence.geometry.coordinates
            map.setView([lat, lng], 16)
          }
        } catch (_) {}

        // Notify other UI (no popup triggered here)
        try { window.dispatchEvent(new CustomEvent('fenceFocused', { detail: fence })) } catch (_) {}
      } catch (_) {}
    }
    window.addEventListener('focusFenceOnMap', onExternalFocus)
    return () => window.removeEventListener('focusFenceOnMap', onExternalFocus)
  }, [map])

  // Save fences when fence mode is closed
  React.useEffect(() => {
    // Nur beim Schließen (fenceOpen wird false)
    if (fenceOpen) return // Noch offen, nichts tun
    if (!map || !drawnItemsRef.current) return
    
    console.log('FenceDrawer: Fence mode closed, checking if auto-save needed')
    console.log('FenceDrawer: layerModifiedRef.current =', layerModifiedRef.current)
    
    try {
      const layers = drawnItemsRef.current?.getLayers?.() || []
      // Nur speichern wenn Layer wirklich geändert wurde
      if (layers.length > 0 && auth?.loggedIn && layerModifiedRef.current) {
        console.log('FenceDrawer: Auto-saving modified layers')
        layers.forEach((layer) => {
          const geoJSON = layer.toGeoJSON()
          console.log('FenceDrawer: Auto-saving layer on close:', geoJSON)
          
          const dragoniteAreaId = localStorage.getItem('dragoniteAreaId')
          fetch('/api/v1/users/geofence', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'same-origin',
            body: JSON.stringify({ 
              geometry: geoJSON.geometry,
              dragoniteAreaId: dragoniteAreaId || undefined
            }),
          })
            .then(async (res) => {
              if (res.ok) {
                const data = await res.json()
                console.log('FenceDrawer: Auto-saved on close', data)
                if (data.dragoniteId) {
                  localStorage.setItem('dragoniteAreaId', String(data.dragoniteId))
                }
              }
            })
            .catch((err) => console.warn('FenceDrawer: Auto-save on close failed', err))
        })
      } else {
        console.log('FenceDrawer: Skipping auto-save (no modifications)')
      }
      // Clear layers nach dem Speichern
      drawnItemsRef.current?.clearLayers?.()
      // Reset modified flag
      layerModifiedRef.current = false
      
      // CRITICAL: Remove and reset drawControl when closing fence mode
      if (drawControlRef.current) {
        console.log('FenceDrawer: Removing drawControl on fence mode close')
        try {
          map.removeControl(drawControlRef.current)
        } catch (e) {
          console.warn('FenceDrawer: Failed to remove drawControl', e)
        }
        drawControlRef.current = null
      }
      
      // CRITICAL: Reset all other refs to ensure clean state on reopen
      serverLoadedRef.current = false
      didFitRef.current = false
      lastUserKeyRef.current = ''
      attachLayerInteractionsRef.current = null
      
      console.log('FenceDrawer: Fence mode closed, all state reset')
      refreshWorkerStats()
    } catch (e) {
      console.warn('FenceDrawer: Auto-save on close failed', e)
    }
  }, [fenceOpen, auth?.loggedIn]) // Trigger wenn fenceOpen sich ändert

  // Reload fences when fence mode is opened
  React.useEffect(() => {
    if (!map || !fenceOpen || !drawnItemsRef.current) return
    
    console.log('FenceDrawer: Fence mode opened, reloading fences from server')
    loadAllFences()
  }, [fenceOpen, auth?.loggedIn, loadAllFences]) // Trigger when fenceOpen changes

  // Listen for fence deletion from FencePanel button
  React.useEffect(() => {
    if (!map || !fenceOpen) return
    
    const handleFenceDeleted = () => {
      console.log('FenceDrawer: Received fenceDeleted event, reloading fences')
      try {
        // Clear selected fence
        setSelectedFence(null)
        selectedFenceRef.current = null
        
        // Reload all fences
        setTimeout(() => {
          loadAllFences()
        }, 500)
        
        console.log('FenceDrawer: Reloading fences after delete')
      } catch (e) {
        console.warn('FenceDrawer: Failed to reload fences after delete', e)
      }
    }
    
    window.addEventListener('fenceDeleted', handleFenceDeleted)
    return () => window.removeEventListener('fenceDeleted', handleFenceDeleted)
  }, [map, fenceOpen, loadAllFences])

  // Listen for save fence edit event from FencePanel "Übernehmen" button
  React.useEffect(() => {
    if (!map || !fenceOpen) return
    
    const handleSaveFenceEdit = (e) => {
      const fenceToSave = e.detail
      console.log('FenceDrawer: Received saveFenceEdit event for fence:', fenceToSave)
      
      if (!fenceToSave?.id) {
        console.warn('FenceDrawer: No fence ID provided for save')
        return
      }
      
      try {
        // Find the layer for this fence
        const layers = drawnItemsRef.current?.getLayers() || []
        const layer = layers.find(l => l.fenceData?.id === fenceToSave.id)
        
        if (!layer) {
          console.warn('FenceDrawer: Could not find layer for fence', fenceToSave.id)
          try { 
            window.alert('Fehler: Fence-Layer nicht gefunden') 
          } catch (_) {}
          return
        }
        
        // Get the geometry and save
        const geoJSON = layer.toGeoJSON()
        console.log('FenceDrawer: Saving fence', fenceToSave.id, fenceToSave.name)
        
        fetch(`/api/v1/users/geofence/${fenceToSave.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'same-origin',
          body: JSON.stringify({ 
            geometry: geoJSON.geometry,
          }),
        })
          .then(async (res) => {
            if (!res.ok) {
              const t = await res.text().catch(() => '')
              throw new Error(t || 'Fehler beim Speichern')
            }
            return res.json()
          })
          .then((data) => {
            console.log('FenceDrawer: Fence erfolgreich gespeichert', data)
            try { 
              window.alert(`Fence "${fenceToSave.name}" erfolgreich gespeichert!`) 
            } catch (_) {}
            
            // Reset modified flag
            layerModifiedRef.current = false
            
            // Disable edit handler
            try {
              const tb = drawControlRef.current?._toolbars
              const editHandler = tb?.edit?._modes?.edit?.handler
              editHandler?.disable?.()
            } catch (_) {}
            
            // Reload fences to ensure consistency
            setTimeout(() => {
              loadAllFences()
            }, 500)
          })
          .catch((err) => {
            console.error('FenceDrawer: Speichern fehlgeschlagen', err)
            try { 
              window.alert('Fehler beim Speichern: ' + err.message) 
            } catch (_) {}
          })
      } catch (e) {
        console.warn('FenceDrawer: Save fence edit failed', e)
        try { 
          window.alert('Fehler beim Speichern: ' + e.message) 
        } catch (_) {}
      }
    }
    
    window.addEventListener('saveFenceEdit', handleSaveFenceEdit)
    return () => window.removeEventListener('saveFenceEdit', handleSaveFenceEdit)
  }, [map, fenceOpen, loadAllFences])

  // Listen for actions from the FencePanel to start draw/edit modes
  React.useEffect(() => {
    if (!map || !fenceOpen || !drawControlRef.current) return
    if (!fenceAction) return
    try {
      const tb = drawControlRef.current && drawControlRef.current._toolbars
      const drawHandler = tb?.draw?._modes?.polygon?.handler
      const editHandler = tb?.edit?._modes?.edit?.handler
      if (fenceAction === 'draw') {
        console.log('FenceDrawer: fenceAction=draw, attempting to enable drawing')
        if (!auth?.loggedIn) { try { window.alert('Bitte melde dich an, um zu zeichnen.') } catch (_) {} }
        try { editHandler?.disable?.() } catch (_) {}

        // Check current layer count against worker limit
        const available = workerStatsRef.current?.available
        if (available !== undefined && available <= 0) {
          console.log('FenceDrawer: Cannot start drawing, no available workers')
          try { window.alert('Keine freien Worker verfügbar. Entferne Worker oder lösche eine Fence, um fortzufahren.') } catch (_) {}
          useLayoutStore.setState({ fenceAction: '' })
          return
        }
        const limit = workerStatsRef.current?.total
        const userKeyDraw = auth?.discordId || auth?.telegramId || auth?.username
        const layersDraw = drawnItemsRef.current?.getLayers?.() || []
        const ownLayerCount = layersDraw.filter((layer) => {
          try {
            return layer?.fenceData && layer.fenceData.owner === userKeyDraw
          } catch (_) {
            return false
          }
        }).length
        if (limit && limit > 0 && ownLayerCount >= limit) {
          console.log('FenceDrawer: Cannot start drawing, fence limit reached')
          try { window.alert(`Du kannst maximal ${limit} Fences erstellen. Entferne eine vorhandene Fence, um eine neue zu zeichnen.`) } catch (_) {}
          useLayoutStore.setState({ fenceAction: '' })
          return
        }
        console.log('FenceDrawer: Current own layer count:', ownLayerCount)

        let ok = false
        try { 
          if (drawHandler) {
            console.log('FenceDrawer: Enabling drawHandler')
            drawHandler.enable()
            ok = true
          } else {
            console.warn('FenceDrawer: drawHandler not found')
          }
        } catch (e) { 
          console.warn('FenceDrawer: drawHandler.enable failed', e) 
        }
        if (!ok) {
          try {
            console.log('FenceDrawer: Trying fallback L.Draw.Polygon')
            const polyOpts = (drawControlRef.current?.options?.draw && drawControlRef.current.options.draw.polygon) || {}
            const fresh = new L.Draw.Polygon(map, polyOpts)
            fresh.enable()
            console.log('FenceDrawer: started drawing via fallback L.Draw.Polygon')
          } catch (e2) {
            console.error('FenceDrawer: Fallback polygon enable failed', e2)
          }
        }
      } else if (fenceAction === 'edit') {
        if (!auth?.loggedIn) { try { window.alert('Bitte melde dich an, um zu bearbeiten.') } catch (_) {} }
        try { drawHandler?.disable?.() } catch (_) {}
        layerModifiedRef.current = true // Mark as modified when entering edit mode
        let ok = false
        try { editHandler?.enable?.(); ok = true } catch (e) { console.warn('FenceDrawer: editHandler.enable failed', e) }
        if (!ok) {
          try {
            const editOpts = { featureGroup: drawnItemsRef.current }
            const freshEdit = new L.EditToolbar.Edit(map, editOpts)
            freshEdit.enable()
            console.log('FenceDrawer: started edit via fallback L.EditToolbar.Edit')
          } catch (e2) {
            console.error('FenceDrawer: Fallback edit enable failed', e2)
          }
        }

        // Attach snapping to edit vertices (dragging should snap to existing fence edges)
        // Use setTimeout to wait for Leaflet.Draw to create the edit markers
        setTimeout(() => {
          try {
            const guideLayers = []
            try {
              drawnItemsRef.current?.eachLayer?.((l) => {
                if (l && typeof l.getLatLngs === 'function') {
                  guideLayers.push(l)
                  // Add explicit edge polylines for better snapping
                  try {
                    const rings = l.getLatLngs()
                    const flat = Array.isArray(rings) ? rings : []
                    const all = flat.flat(2)
                    if (Array.isArray(all) && all.length > 1) {
                      const pl = L.polyline(all)
                      guideLayers.push(pl)
                    }
                  } catch (_) {}
                } else if (l && typeof l.getPaths === 'function') {
                  guideLayers.push(l)
                }
              })
            } catch (_) {}
            console.log('FenceDrawer: guideLayers for edit:', guideLayers.length)

            drawnItemsRef.current?.eachLayer?.((layer) => {
              // Filter out the currently edited layer from guide layers
              const filteredGuideLayers = guideLayers.filter(gl => gl !== layer)
            try {
              const editing = layer && layer.editing
              const markers = editing && (editing._markers || editing._markerGroup?.getLayers?.() || [])
              if (Array.isArray(markers)) {
                markers.forEach((m) => {
                  try {
                    if (!m || m._rmSnapAttached) return
                    m._rmSnapAttached = true
                    const snapDistMeters = 200
                    
                    const snapToNearestEdge = (markerLatLng) => {
                      try {
                        const point = turf.point([markerLatLng.lng, markerLatLng.lat])
                        let closestSnap = null
                        let minDist = Infinity
                        
                        filteredGuideLayers.forEach((guideLayer) => {
                          try {
                            if (typeof guideLayer.getLatLngs === 'function') {
                              const latlngs = guideLayer.getLatLngs()
                              const coords = Array.isArray(latlngs[0]) ? latlngs[0] : latlngs
                              if (coords.length > 1) {
                                // Check distance to each vertex (corner point) - prioritize vertices with smaller radius
                                const vertexSnapDist = Math.min(snapDistMeters, 50) // Max 50m for vertices
                                coords.forEach((coord) => {
                                  try {
                                    const vertexPoint = turf.point([coord.lng, coord.lat])
                                    const dist = distance(point, vertexPoint, { units: 'meters' })
                                    // Vertices get priority by reducing their effective distance
                                    const effectiveDist = dist * 0.5 // Vertices are "twice as attractive"
                                    if (effectiveDist < minDist && dist <= vertexSnapDist) {
                                      minDist = effectiveDist
                                      closestSnap = { lat: coord.lat, lng: coord.lng }
                                    }
                                  } catch (_) {}
                                })
                                
                                // Also check distance to edges (lines between vertices)
                                const lineCoords = coords.map(ll => [ll.lng, ll.lat])
                                const line = turf.lineString(lineCoords)
                                const nearest = nearestPointOnLine(line, point, { units: 'meters' })
                                const dist = distance(point, nearest, { units: 'meters' })
                                if (dist < minDist && dist <= snapDistMeters) {
                                  minDist = dist
                                  closestSnap = { lat: nearest.geometry.coordinates[1], lng: nearest.geometry.coordinates[0] }
                                }
                              }
                            }
                          } catch (_) {}
                        })
                        
                        if (closestSnap) {
                          console.log('FenceDrawer: Edit snap to', closestSnap, 'distance:', minDist.toFixed(1), 'm')
                          return closestSnap
                        }
                        return null
                      } catch (err) {
                        console.warn('FenceDrawer: snapToNearestEdge error', err)
                        return null
                      }
                    }
                    
                    // Initial snap to nearest edge
                    try {
                      const snap = snapToNearestEdge(m.getLatLng())
                      if (snap) {
                        m.setLatLng(snap)
                        // Force layer to redraw
                        try {
                          if (layer && layer.redraw) layer.redraw()
                        } catch (_) {}
                      }
                    } catch (_) {}
                    
                    // Continuous snapping while dragging
                    try {
                      m.off('drag')
                      m.on('drag', () => {
                        try {
                          const snap = snapToNearestEdge(m.getLatLng())
                          if (snap) {
                            m.setLatLng(snap)
                            // Force layer to redraw
                            try {
                              if (layer && layer.redraw) layer.redraw()
                            } catch (_) {}
                          }
                        } catch (_) {}
                      })
                    } catch (_) {}
                  } catch (_) {}
                })
              }
            } catch (_) {}
            })
          } catch (e3) {
            console.warn('FenceDrawer: Failed to attach snap to edit markers', e3)
          }
        }, 100) // Wait 100ms for Leaflet.Draw to create markers
      } else if (fenceAction === 'stop') {
        // Speichern der Änderungen beim Beenden des Edit-Modus
        try { 
          if (layerModifiedRef.current && drawnItemsRef.current) {
            console.log('FenceDrawer: Saving changes on edit stop')
            const layers = drawnItemsRef.current.getLayers()
            if (layers.length > 0) {
              // Trigger save for all modified layers
              layers.forEach((layer) => {
                const geoJSON = layer.toGeoJSON()
                const fenceData = layer.fenceData
                
                if (!fenceData?.id) {
                  console.warn('FenceDrawer: No fence data for layer, skipping save')
                  return
                }
                
                console.log('FenceDrawer: Saving fence', fenceData.id, fenceData.name)
                
                // Save to backend
                fetch(`/api/v1/users/geofence/${fenceData.id}`, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  credentials: 'same-origin',
                  body: JSON.stringify({ 
                    geometry: geoJSON.geometry,
                  }),
                })
                  .then(async (res) => {
                    if (!res.ok) {
                      const t = await res.text().catch(() => '')
                      throw new Error(t || 'Fehler beim Speichern')
                    }
                    return res.json()
                  })
                  .then((data) => {
                    console.log('FenceDrawer: Fence gespeichert', data)
                    // Show success message
                    try { 
                      window.alert(`Fence "${fenceData.name}" erfolgreich gespeichert!`) 
                    } catch (_) {}
                  })
                  .catch((err) => {
                    console.error('FenceDrawer: Speichern fehlgeschlagen', err)
                    try { 
                      window.alert('Fehler beim Speichern: ' + err.message) 
                    } catch (_) {}
                  })
              })
            }
            // Reset modified flag after save
            layerModifiedRef.current = false
          }
        } catch (e) {
          console.warn('FenceDrawer: Save on stop failed', e)
        }
        
        try { drawHandler?.disable?.() } catch (_) {}
        try { editHandler?.disable?.() } catch (_) {}
      } else if (fenceAction === 'cancel') {
        // Abbrechen: Änderungen verwerfen, Edit-Modus beenden und Original-Fences neu laden
        console.log('FenceDrawer: Cancel edit - reverting changes and disabling handlers')
        try { drawHandler?.disable?.() } catch (_) {}
        try { editHandler?.disable?.() } catch (_) {}
        if (layerModifiedRef.current) {
          try {
            // Reload from server to discard any client-side edits
            loadAllFences()
          } catch (e) {
            console.warn('FenceDrawer: Failed to reload fences on cancel', e)
          }
        }
        layerModifiedRef.current = false
      }
    } finally {
      // Do not clear 'edit' here; keep it until user explicitly saves or cancels
      if (fenceAction !== 'edit') {
        useLayoutStore.setState({ fenceAction: '' })
      }
    }
  }, [map, fenceOpen, fenceAction, auth?.loggedIn, workerStats?.total])

  React.useEffect(() => {
    if (!fenceOpen) return
    refreshWorkerStats()
  }, [fenceOpen, refreshWorkerStats])

  // Disable auto-loading outside Fence mode; loading happens when Fence mode opens above
  React.useEffect(() => {
    if (!map || !fenceOpen) return
    if (!drawnItemsRef.current) {
      drawnItemsRef.current = new L.FeatureGroup()
      map.addLayer(drawnItemsRef.current)
    }
  }, [map, fenceOpen])

  // Reload server fences when authentication state changes (e.g., after login)
  React.useEffect(() => {
    if (!map || !auth?.loggedIn || !fenceOpen) return
    const userKey = auth.discordId || auth.telegramId || auth.username || ''
    if (!userKey || lastUserKeyRef.current === userKey) return
    lastUserKeyRef.current = userKey

    try {
      fetch('/api/v1/users/geofence', { credentials: 'same-origin' })
        .then((res) => (res.ok ? res.json() : Promise.reject(res)))
        .then((fc) => {
          if (fc && fc.features && Array.isArray(fc.features)) {
            console.log('FenceDrawer: Reloading server fences after login:', fc.features.length)
            try { drawnItemsRef.current.clearLayers?.() } catch (_) {}
            const layer = L.geoJSON(fc, {
              style: (f) =>
                f && f.geometry && f.geometry.type.includes('Polygon')
                  ? { color: '#ff33aa', weight: 2, fillColor: '#ff33aa', fillOpacity: 0.15 }
                  : undefined,
            })
            layer.eachLayer((l) => {
              drawnItemsRef.current.addLayer(l)
            })
            drawnItemsRef.current.bringToFront?.()
            // Always fit after login to ensure visibility
            const b = layer.getBounds?.()
            if (b && b.isValid && b.isValid()) {
              map.fitBounds(b.pad(0.1))
              didFitRef.current = true
            }
          }
        })
        .catch((err) => {
          console.warn('FenceDrawer: Failed to reload server fences after login', err)
        })
    } catch (err) {
      console.warn('FenceDrawer: Failed to reload server fences after login', err)
    }
  }, [map, fenceOpen, auth?.loggedIn, auth?.discordId, auth?.telegramId, auth?.username])

  React.useEffect(() => {
    return () => {
      if (drawControlRef.current && map) {
        map.removeControl(drawControlRef.current)
      }
      if (drawnItemsRef.current && map) {
        map.removeLayer(drawnItemsRef.current)
      }
    }
  }, [map])

  return (
    <>
      {/* Worker Management Popup - Only when explicitly requested via fenceAction === 'manage' */}
      {fenceOpen && selectedFence && fenceAction === 'manage' && (
        <FenceWorkerPopup 
          key={selectedFence.id} // Force re-render when fence changes
          selectedFence={selectedFence}
          onClose={() => {
            setSelectedFence(null)
            selectedFenceRef.current = null
            // Reset all fence styles to default
            if (drawnItemsRef.current) {
              drawnItemsRef.current.eachLayer((layer) => {
                layer.setStyle({
                  color: '#ff33aa',
                  weight: 2,
                  fillColor: '#ff33aa',
                  fillOpacity: 0.15
                })
              })
            }
          }}
        />
      )}
    </>
  )
}
