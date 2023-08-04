import React from 'react'
import { MapContainer, Pane } from 'react-leaflet'

import useGenerate from '@hooks/useGenerate'
import useRefresh from '@hooks/useRefresh'

import Map from './Map'

export default function Container({ serverSettings, params, location, zoom }) {
  useGenerate()
  useRefresh()

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
      // style={{
      //   width: '100vw',
      //   height: '100vh',
      // }}
      maxBounds={[
        [-90, -210],
        [90, 210],
      ]}
      preferCanvas
    >
      {serverSettings.user && serverSettings.user.perms.map && (
        <Map serverSettings={serverSettings} params={params} />
      )}
      <Pane name="geojson" style={{ zIndex: 501 }} />
      <Pane name="circlePane" style={{ zIndex: 450, pointerEvents: 'none' }} />
      <Pane name="scanCells" style={{ zIndex: 400 }} />
      <Pane name="routes" style={{ zIndex: 399 }} />
    </MapContainer>
  )
}
