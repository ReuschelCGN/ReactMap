import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { setUser } from '@sentry/react'

import { useMemory } from '@hooks/useMemory'
import { useStorage } from '@hooks/useStorage'
import Fetch from '@services/Fetch'
import { setLoadingText } from '@services/functions/setLoadingText'
import Utility from '@services/Utility'
import { deepMerge } from '@services/functions/deepMerge'
import { Navigate } from 'react-router-dom'
import { checkHoliday } from '@services/functions/checkHoliday'
import { useHideElement } from '@hooks/useHideElement'
import { getGlowRules } from '@services/functions/getGlowRules'

import { useScannerSessionStorage } from './layout/dialogs/scanner/store'

export default function Config({ children }) {
  const { t } = useTranslation()
  const [serverSettings, setServerSettings] = React.useState({
    error: false,
    status: 200,
    fetched: false,
  })

  useHideElement(serverSettings.fetched)

  const getServerSettings = async () => {
    const data = await Fetch.getSettings()

    if (data) {
      document.title = data?.map?.general.headerTitle || document.title

      Utility.analytics(
        'User',
        data.user ? `${data.user.username} (${data.user.id})` : 'Not Logged In',
        'Permissions',
        true,
      )
      if (CONFIG.sentry.client.enabled) {
        setUser({
          username: data.user.username,
          id: data.user.discordId || data.user.telegramId || data.user.id,
        })
      }

      /** @type {{ state: import('@hooks/useStorage').UseStorage}} */
      const localState = JSON.parse(
        localStorage.getItem('local-state') || '{ "state": {} }',
      )

      /**
       * @template T
       * @param {T} defaults
       * @param {string} category
       * @returns {T}
       */
      const updatePositionState = (defaults, category) => {
        if (localState?.state?.[category]) {
          return localState.state[category]
        }
        return defaults
      }

      const defaultLocation = /** @type {const} */ ([
        data.map.general.startLat,
        data.map.general.startLon,
      ])
      const location = updatePositionState(defaultLocation, 'location').map(
        (x, i) =>
          x ||
          (i === 0 ? data.map.general.startLat : data.map.general.startLon),
      )

      const zoom = updatePositionState(data.map.general.startZoom, 'zoom')
      const safeZoom =
        zoom < data.map.general.minZoom || zoom > data.map.general.maxZoom
          ? data.map.general.minZoom
          : zoom

      const settings = {
        navigationControls: {
          react: { name: 'react' },
          leaflet: { name: 'leaflet' },
        },
        navigation: Object.fromEntries(
          data.navigation.map((item) => [item.name, item]),
        ),
        tileServers: Object.fromEntries(
          data.tileServers.map((item) => [item.name, item]),
        ),
        distanceUnit: {
          kilometers: { name: 'kilometers' },
          miles: { name: 'miles' },
        },
      }

      useScannerSessionStorage.setState((prev) => ({
        cooldown: Math.max(prev.cooldown, data.user.cooldown || 0),
      }))
      useMemory.setState({
        auth: {
          strategy: data.user?.strategy || '',
          discordId: data.user?.discordId || '',
          telegramId: data.user?.telegramId || '',
          webhookStrategy: data.user?.webhookStrategy || '',
          loggedIn: !!data.user?.loggedIn,
          perms: data.user ? data.user.perms : {},
          methods: data.authentication.methods || [],
          username: data.user?.username || '',
          data: data.user?.data
            ? typeof data.user?.data === 'string'
              ? JSON.parse(data.user?.data)
              : data.user?.data
            : {},
          counts: data.authReferences || {},
          userBackupLimits: data.database.settings.userBackupLimits || 0,
          excludeList: data.authentication.excludeList || [],
        },
        theme: data.map.theme,
        ui: data.ui,
        menus: data.menus,
        extraUserFields: data.database.settings.extraUserFields,
        userSettings: data.userSettings,
        clientMenus: data.clientMenus,
        glowRules: getGlowRules(data.clientMenus.pokemon.glow.sub),
        timeOfDay: Utility.timeCheck(...location),
        config: {
          ...data.map,
          holidayEffects: (data.map.holidayEffects || []).filter(checkHoliday),
        },
        polling: data.api.polling,
        settings,
        gymValidDataLimit: data.api.gymValidDataLimit,
        tutorialExcludeList: data.authentication.excludeFromTutorial || [],
      })

      useStorage.setState((prev) => ({
        tutorial:
          !localState?.state?.tutorial || data.user.tutorial === undefined
            ? !!localState?.state?.tutorial
            : !data.user.tutorial,
        menus: deepMerge({}, data.menus, prev.menus),
        userSettings: deepMerge({}, data.userSettings, prev.userSettings),
        settings: {
          ...Object.fromEntries(
            Object.entries(settings).map(([k, v]) => [
              k,
              data.map.misc[k] || Object.keys(v)[0],
            ]),
          ),
          ...prev.settings,
        },
        zoom: safeZoom,
        location,
      }))
      setServerSettings({ ...serverSettings, fetched: true })
    } else {
      setServerSettings({ error: true, status: 500, fetched: true })
    }
  }

  React.useEffect(() => {
    if (!serverSettings.fetched) {
      setLoadingText(t('loading_settings'))
      getServerSettings()
    }
  }, [])

  if (serverSettings.error) {
    return <Navigate to={`/error/${serverSettings.status}`} />
  }

  return serverSettings.fetched && serverSettings.status !== 500
    ? children
    : null
}
