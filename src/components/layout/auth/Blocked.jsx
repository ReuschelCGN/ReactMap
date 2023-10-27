/* eslint-disable react/no-array-index-key */
import React from 'react'
import { useParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import Grid from '@mui/material/Grid'
import Typography from '@mui/material/Typography'
import Button from '@mui/material/Button'
import { useStatic } from '@hooks/useStore'

import DiscordLogin from './Discord'

export default function Blocked() {
  const { t } = useTranslation()
  const { info } = useParams()
  const discordInvite = useStatic((s) => s.config.links.discordInvite)

  const queryParams = new URLSearchParams(info)

  return (
    <Grid
      container
      direction="column"
      justifyContent="center"
      alignItems="center"
      style={{ minHeight: '95vh' }}
    >
      <Grid item>
        <Typography variant="h3" align="center">
          {t('access')} {t('denied')}!
        </Typography>
      </Grid>
      <br />
      <br />

      {queryParams.get('blockedGuilds') && (
        <Grid item>
          <Typography variant="h6" align="center">
            {t('on_block_msg')} {queryParams.get('blockedGuilds')}.
          </Typography>
        </Grid>
      )}

      {discordInvite && (
        <Grid item>
          <br />
          <Typography variant="h6" align="center">
            {t('on_block_join_discord')}
          </Typography>
        </Grid>
      )}

      <Grid
        container
        item
        justifyContent="center"
        alignItems="center"
        style={{ marginTop: 20, paddingTop: 20, marginBottom: 20 }}
      >
        <Grid
          item
          xs={discordInvite ? 3 : 10}
          sm={discordInvite ? 3 : 10}
          style={{
            textAlign: 'center',
            marginTop: discordInvite ? 20 : 0,
          }}
        >
          <Button
            variant="contained"
            color="primary"
            onClick={() => (window.location = window.location.origin)}
            size="large"
          >
            {t('go_back')}
          </Button>
        </Grid>
        {discordInvite && (
          <Grid
            item
            xs={3}
            sm={3}
            style={{ textAlign: 'center', marginTop: 20 }}
          >
            <DiscordLogin href={discordInvite}>join</DiscordLogin>
          </Grid>
        )}
      </Grid>
    </Grid>
  )
}
