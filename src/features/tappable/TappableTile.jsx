/* eslint-disable react/destructuring-assignment */
// @ts-check
import * as React from 'react'
import { Marker, Popup, Circle } from 'react-leaflet'
import { divIcon } from 'leaflet'

import { useMemory } from '@store/useMemory'
import { useMemory, basicEqualFn } from '@store/useMemory'
import { useForcePopup } from '@hooks/useForcePopup'
import { useMarkerTimer } from '@hooks/useMarkerTimer'
import { useOpacity } from '@hooks/useOpacity'
import { TooltipWrapper } from '@components/ToolTipWrapper'

import { TappablePopup } from './TappablePopup'

/**
 * @param {import('@rm/types').Tappable} tappable
 */
const BaseTappableTile = (tappable) => {
  const Icons = useMemory((s) => s.Icons)
  const itemFilters = useStorage((s) => s.filters?.tappables?.filter || {})
  const [timerForced, interactionRangeZoom] = useMemory((s) => {
    const {
      timerList,
      config: { general = {} },
    } = s
    const zoomLimit = Number.isFinite(general.interactionRangeZoom)
      ? general.interactionRangeZoom
      : 15
    return [
      tappable.id == null ? false : timerList.includes(tappable.id),
      zoomLimit,
    ]
  }, basicEqualFn)
  const [showTimerSetting, showInteractionRange] = useStorage((s) => {
    const { userSettings, zoom } = s
    return [
      !!userSettings.tappables?.tappableTimers,
      !!userSettings.tappables?.interactionRanges &&
        zoom >= interactionRangeZoom,
    ]
  }, basicEqualFn)

  const [markerRef, setMarkerRef] = React.useState(null)
  useForcePopup(tappable.id, markerRef)
  useMarkerTimer(tappable.expire_timestamp || 0, markerRef)

  const getOpacity = useOpacity('tappables')
  const opacity = React.useMemo(
    () =>
      tappable.expire_timestamp ? getOpacity(tappable.expire_timestamp) : 1,
    [getOpacity, tappable.expire_timestamp],
  )

  const { icon, rewardIcon, size } = React.useMemo(() => {
    if (!Icons || !tappable.item_id) {
      return { icon: null, rewardIcon: '', size: 24 }
    }
    const filterKey = `q${tappable.item_id}`
    const tappableSize =
      Icons.getSize('tappable', itemFilters[filterKey]?.size) * 1.3
    const tappableIcon = Icons.getRewards(
      2,
      tappable.item_id,
      tappable.count || 1,
    )
    const tappableReward = Icons.getRewards(
      2,
      tappable.item_id,
      tappable.count || 1,
    )
    if (!tappableIcon) {
      return { icon: null, rewardIcon: '', size: tappableSize }
    }
    const [tappableMod, rewardMod] = Icons.getModifiers('tappable', 'reward')
    const popupAnchor = [
      tappableMod?.popupX || 0,
      tappableSize * -0.3 * (tappableMod?.offsetY || 1) +
        (tappableMod?.popupY || 0),
    ]

    const html = `
      <div
        class="tappable-marker"
        style="--tappable-size:${tappableSize}px;opacity:${opacity};"
      >

      <div
        id="tappable-${tappable.item_id}"
        class="marker-image-holder top-overlay"
        style="
          opacity: ${opacity};
        "
      >

        <img
          class="tappable-marker__icon"
          src="${tappableIcon}"
          alt="${tappable.item_id || ''}"
        />
        <img
          src="${Icons.getMisc('tappable')}"
          alt="tappable_item"
          style="
            width: ${tappableSize / 1.5}px;
            height: auto;
            bottom: ${(-tappableSize / 5) * tappableMod?.offsetY}px;
            left: -50%;
          "
        />
      </div>
    `

    return {
      size: tappableSize,
      rewardIcon: tappableReward,
      icon: divIcon({
        className: 'tappable-marker-icon',
        iconAnchor: [tappableSize / 2, tappableSize / 2],
        popupAnchor,
        html,
      }),
    }
  }, [
    Icons,
    itemFilters,
    tappable.type,
    tappable.item_id,
    tappable.count,
    opacity,
  ])

  if (!Icons || !icon) {
    return null
  }

  const timers = React.useMemo(
    () => (tappable.expire_timestamp ? [tappable.expire_timestamp] : []),
    [tappable.expire_timestamp],
  )

  return (
    <Marker
      ref={setMarkerRef}
      position={[tappable.lat, tappable.lon]}
      icon={icon}
    >
      <Popup position={[tappable.lat, tappable.lon]}>
        <TappablePopup
          tappable={tappable}
          rewardIcon={rewardIcon}
          iconSize={size}
        />
      </Popup>
      {showTimer && !!timers.length && (
        <TooltipWrapper offset={[0, 4]} timers={timers} />
      )}
      {showInteractionRange && (
        <Circle
          center={[tappable.lat, tappable.lon]}
          radius={40}
          pathOptions={{ color: '#0DA8E7', weight: 1 }}
        />
      )}
    </Marker>
  )
}

export const TappableTile = React.memo(
  BaseTappableTile,
  (prev, next) => prev.id === next.id && prev.updated === next.updated,
)
