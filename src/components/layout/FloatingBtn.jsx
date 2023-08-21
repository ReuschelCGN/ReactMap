// @ts-check
import * as React from 'react'
import Menu from '@mui/icons-material/Menu'
import MyLocation from '@mui/icons-material/MyLocation'
import ZoomIn from '@mui/icons-material/ZoomIn'
import ZoomOut from '@mui/icons-material/ZoomOut'
import Search from '@mui/icons-material/Search'
import NotificationsActive from '@mui/icons-material/NotificationsActive'
import Save from '@mui/icons-material/Save'
import CardMembership from '@mui/icons-material/CardMembership'
import AttachMoney from '@mui/icons-material/AttachMoney'
import Stack from '@mui/material/Stack'
// import CurrencyBitcoinIcon from '@mui/icons-material/CurrencyBitcoin'
// import CurrencyPoundIcon from '@mui/icons-material/CurrencyPound'
import EuroSymbol from '@mui/icons-material/EuroSymbol'
import Person from '@mui/icons-material/Person'
import TrackChanges from '@mui/icons-material/TrackChanges'
import BlurOn from '@mui/icons-material/BlurOn'
import Fab from '@mui/material/Fab'
import { useQuery } from '@apollo/client'

import { useTranslation } from 'react-i18next'
import { useMap } from 'react-leaflet'
import { DomEvent } from 'leaflet'

import { FAB_BUTTONS } from '@services/queries/config'
import useLocation from '@hooks/useLocation'
import {
  useLayoutStore,
  useScanStore,
  useStatic,
  useStore,
} from '@hooks/useStore'

import { I } from './general/I'
import { setModeBtn, useWebhookStore } from './dialogs/webhooks/store'

/** @typedef {keyof ReturnType<typeof useLayoutStore['getState']> | keyof ReturnType<typeof useScanStore['getState']>} Keys */

const DonationIcons = {
  dollar: AttachMoney,
  euro: EuroSymbol,
  card: CardMembership,
  // bitcoin: CurrencyBitcoinIcon,
  // pound: CurrencyPoundIcon,
}

const DEFAULT = {
  custom: [],
  donationButton: '',
  profileButton: false,
  scanNext: false,
  scanZone: false,
  webhooks: false,
  search: false,
}

/** @param {Keys} name */
const handleClick = (name) => () => {
  switch (name) {
    case 'scanZoneMode':
    case 'scanNextMode':
      return useScanStore.setState((prev) => ({
        [name]: prev[name] === 'setLocation' ? '' : 'setLocation',
      }))
    default:
      return useLayoutStore.setState({ [name]: true })
  }
}

export default function FloatingButtons() {
  const { t } = useTranslation()
  const { data } = useQuery(FAB_BUTTONS, {
    fetchPolicy: 'cache-first',
  })
  const map = useMap()
  const { lc, color } = useLocation()

  const reactControls = useStore(
    (s) => s.settings.navigationControls === 'react',
  )

  const isMobile = useStatic((s) => s.isMobile)
  const webhookMode = useWebhookStore((s) => s.mode)

  const scanNextMode = useScanStore((s) => s.scanNextMode)
  const scanZoneMode = useScanStore((s) => s.scanZoneMode)

  const ref = React.useRef(null)

  const fabButtons = /** @type {typeof DEFAULT} */ (data?.fabButtons || DEFAULT)

  const DonorIcon = React.useMemo(
    () =>
      fabButtons.donationButton in DonationIcons
        ? DonationIcons[fabButtons.donationButton]
        : null,
    [fabButtons.donationButton],
  )

  const fabSize = isMobile ? 'small' : 'large'
  const iconSize = isMobile ? 'small' : 'medium'
  const disabled = !!webhookMode || !!scanNextMode || !!scanZoneMode

  const handleNavBtn = React.useCallback(
    (/** @type {'zoomIn' | 'zoomOut' | 'locate'} */ name) => () => {
      switch (name) {
        case 'zoomIn':
          return map.zoomIn()
        case 'zoomOut':
          return map.zoomOut()
        case 'locate':
          return lc._onClick()
        default:
          break
      }
    },
    [map],
  )

  React.useEffect(() => {
    DomEvent.disableClickPropagation(ref.current)
  }, [])

  return (
    <Stack ref={ref}>
      <Fab
        color="primary"
        size={fabSize}
        onClick={handleClick('drawer')}
        title={t('open_menu')}
        disabled={disabled}
      >
        <Menu fontSize={iconSize} />
      </Fab>
      {fabButtons.profileButton && (
        <Fab
          color="primary"
          size={fabSize}
          onClick={handleClick('userProfile')}
          title={t('user_profile')}
          disabled={disabled}
        >
          <Person fontSize={iconSize} />
        </Fab>
      )}
      {fabButtons.search && (
        <Fab
          color={reactControls ? 'primary' : 'secondary'}
          size={fabSize}
          onClick={handleClick('search')}
          title={t('search')}
          disabled={disabled}
        >
          <Search fontSize={iconSize} sx={{ color: 'white' }} />
        </Fab>
      )}
      {fabButtons.webhooks && (
        <Fab
          color="secondary"
          size={fabSize}
          onClick={setModeBtn('open')}
          disabled={disabled}
          title={t('alert_manager')}
        >
          <NotificationsActive fontSize={iconSize} sx={{ color: 'white' }} />
        </Fab>
      )}
      {fabButtons.scanNext && (
        <Fab
          color={scanNextMode === 'setLocation' ? 'error' : 'secondary'}
          size={fabSize}
          onClick={handleClick('scanNextMode')}
          title={t('scan_next')}
          disabled={Boolean(webhookMode) || Boolean(scanZoneMode)}
        >
          <TrackChanges fontSize={iconSize} sx={{ color: 'white' }} />
        </Fab>
      )}
      {fabButtons.scanZone && (
        <Fab
          color={scanZoneMode === 'setLocation' ? 'error' : 'secondary'}
          size={fabSize}
          onClick={handleClick('scanZoneMode')}
          title={t('scan_zone')}
          disabled={Boolean(webhookMode) || Boolean(scanNextMode)}
        >
          <BlurOn fontSize={iconSize} sx={{ color: 'white' }} />
        </Fab>
      )}
      {!!DonorIcon && (
        <Fab
          color="secondary"
          size={fabSize}
          onClick={handleClick('donorPage')}
          title={t('donor_menu')}
          disabled={disabled}
        >
          <DonorIcon fontSize={iconSize} sx={{ color: 'white' }} />
        </Fab>
      )}
      {reactControls && (
        <>
          <Fab
            color="secondary"
            size={fabSize}
            onClick={handleNavBtn('locate')}
            title={t('use_my_location')}
          >
            <MyLocation color={color} fontSize={iconSize} />
          </Fab>
          <Fab
            color="secondary"
            size={fabSize}
            onClick={handleNavBtn('zoomIn')}
            title={t('zoom_in')}
          >
            <ZoomIn fontSize={iconSize} sx={{ color: 'white' }} />
          </Fab>
          <Fab
            color="secondary"
            size={fabSize}
            onClick={handleNavBtn('zoomOut')}
            title={t('zoom_out')}
          >
            <ZoomOut fontSize={iconSize} sx={{ color: 'white' }} />
          </Fab>
        </>
      )}
      {fabButtons.webhooks &&
        (webhookMode === 'areas' || webhookMode === 'location') && (
          <Fab
            color="primary"
            size={fabSize}
            onClick={setModeBtn('open')}
            title={t('save')}
          >
            <Save fontSize={iconSize} sx={{ color: 'white' }} />
          </Fab>
        )}
      {fabButtons.custom.map((icon) => (
        <Fab
          key={`${icon.color}${icon.href}${icon.icon}`}
          color={icon.color || 'secondary'}
          size={fabSize}
          href={icon.href}
          referrerPolicy="no-referrer"
          target={icon.target || '_blank'}
          disabled={disabled}
        >
          <I className={icon.icon} size={iconSize} />
        </Fab>
      ))}
    </Stack>
  )
}
