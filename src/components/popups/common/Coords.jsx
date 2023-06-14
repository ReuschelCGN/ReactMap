import React from 'react'

export default function Coords({ lat, lon }) {
  return (
    <Typography variant="caption" style={{ textAlign: 'center' }}>
      🎯 {lat}, {lon}
    </Typography>
  )
}