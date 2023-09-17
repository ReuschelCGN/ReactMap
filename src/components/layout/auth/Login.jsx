/* eslint-disable react/no-array-index-key */
// @ts-check
import * as React from 'react'
import { Navigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Box from '@mui/material/Box'
import Typography from '@mui/material/Typography'
import Grid from '@mui/material/Unstable_Grid2'
import { useQuery } from '@apollo/client'

import { CUSTOM_COMPONENT } from '@services/queries/config'

import { basicEqualFn, useStatic } from '@hooks/useStore'
import LocalLogin from './Local'
import LocaleSelection from '../general/LocaleSelection'
import DiscordLogin from './Discord'
import TelegramLogin from './Telegram'
import CustomTile from '../custom/CustomTile'
import ThemeToggle from '../general/ThemeToggle'
import { Loading } from '../general/Loading'

export default function Login() {
  const [
    loggedIn,
    loginPage,
    headerTitle,
    discordInvite,
    discordAuthUrl,
    telegramBotName,
    telegramAuthUrl,
    localAuthUrl,
  ] = useStatic(
    (s) => [
      s.auth.loggedIn,
      !!s.config.loginPage,
      s.config.general.headerTitle,
      s.config.links.discordInvite,
      s.config.customRoutes.discordAuthUrl,
      s.config.customRoutes.telegramBotName,
      s.config.customRoutes.telegramAuthUrl,
      s.config.customRoutes.localAuthUrl,
    ],
    basicEqualFn,
  )
  const authMethods = useStatic((s) => s.auth.methods)

  const { t } = useTranslation()
  const { data, loading } = useQuery(CUSTOM_COMPONENT, {
    fetchPolicy: 'cache-first',
    variables: { component: 'loginPage' },
    skip: !loginPage,
  })

  if (loading) {
    return <Loading height="100vh">{t('loading', { category: '' })}</Loading>
  }

  if (loggedIn && process.env.NODE_ENV !== 'development') {
    return <Navigate to="/" />
  }

  const { settings, components } = data?.customComponent || {
    settings: {},
    components: [],
  }
  return (
    <>
      <Box position="absolute" top={10} right={10}>
        <ThemeToggle />
      </Box>
      {components?.length ? (
        <Grid
          container
          spacing={settings.parentSpacing || 0}
          alignItems={settings.parentAlignItems || 'center'}
          justifyContent={settings.parentJustifyContent || 'center'}
          style={settings.parentStyle || {}}
          sx={settings.parentSx || {}}
        >
          {components.map((block, i) => (
            <CustomTile key={i} block={block} />
          ))}
        </Grid>
      ) : (
        <Grid
          container
          direction="column"
          justifyContent="center"
          alignItems="center"
          height="100cqh"
          width="100%"
        >
          <Grid pb={8} xs={12}>
            <Typography variant="h3" align="center">
              {t('welcome')} {headerTitle}
            </Typography>
          </Grid>
          {authMethods.includes('discord') && (
            <Grid
              container
              justifyContent="center"
              alignItems="center"
              direction="row"
              xs={12}
            >
              <Grid
                xs={discordInvite ? t('login_button') : 10}
                sm={discordInvite ? 3 : 10}
                textAlign="center"
              >
                <DiscordLogin href={discordAuthUrl} bgcolor="success.dark" />
              </Grid>
              {discordInvite && (
                <Grid xs={t('join_button')} sm={3} textAlign="center">
                  <DiscordLogin href={discordInvite}>join</DiscordLogin>
                </Grid>
              )}
            </Grid>
          )}
          {authMethods?.includes('telegram') && (
            <Grid>
              <TelegramLogin
                botName={telegramBotName}
                authUrl={telegramAuthUrl}
              />
            </Grid>
          )}
          {authMethods?.includes('local') && (
            <Grid>
              <LocalLogin href={localAuthUrl} />
            </Grid>
          )}
        </Grid>
      )}
      {!components?.length && (
        <Box
          position="absolute"
          bottom={20}
          left={0}
          right={0}
          mx="auto"
          width={{ xs: '50%', sm: '33%', md: '25%', lg: '20%' }}
        >
          <LocaleSelection />
        </Box>
      )}
    </>
  )
}
