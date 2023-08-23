import * as React from 'react'
import { MapContainer } from 'react-leaflet'
import useMediaQuery from '@mui/material/useMediaQuery'

import useGenerate from '@hooks/useGenerate'
import useRefresh from '@hooks/useRefresh'
import { useStatic } from '@hooks/useStore'

import Map from './Map'
import ScanOnDemand from './layout/dialogs/scanner/ScanOnDemand'
import DraggableMarker from './layout/dialogs/webhooks/human/Draggable'
import WebhookAreaSelection from './layout/dialogs/webhooks/human/area/AreaSelection'
import Nav from './layout/Nav'
import {
  ControlledLocate,
  ControlledTileLayer,
  ControlledZoomLayer,
} from './Layers'

const MAX_BOUNDS = [
  [-90, -210],
  [90, 210],
]

export default function Container({ serverSettings, params, location, zoom }) {
  useRefresh()
  useGenerate()
  const isMobile = useMediaQuery((t) => t.breakpoints.only('xs'))
  const isTablet = useMediaQuery((t) => t.breakpoints.only('sm'))

  React.useEffect(() => {
    useStatic.setState({ isMobile, isTablet })
  }, [isMobile, isTablet])

  return (
    <MapContainer
      tap={false}
      center={location}
      zoom={
        zoom < serverSettings.config.map.minZoom ||
        zoom > serverSettings.config.map.maxZoom
          ? serverSettings.config.map.minZoom
          : zoom
      }
      zoomControl={false}
      maxBounds={MAX_BOUNDS}
      preferCanvas
    >
      <ControlledTileLayer />
      <ControlledZoomLayer />
      <ControlledLocate />
      {serverSettings.user && serverSettings.user.perms.map && (
        <Map params={params} />
      )}
      <ScanOnDemand mode="scanNext" />
      <ScanOnDemand mode="scanZone" />
      <DraggableMarker />
      <WebhookAreaSelection />
      <Nav />
    </MapContainer>
  )
}
