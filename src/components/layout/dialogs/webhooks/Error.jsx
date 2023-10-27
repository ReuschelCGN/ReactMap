import React from 'react'
import { useTranslation, Trans } from 'react-i18next'
import { Grid, Typography } from '@mui/material'
import { useWebhookStore } from './store'

export default function WebhookError({ children }) {
  const { t } = useTranslation()
  const name = useWebhookStore((s) => s.context.name)
  return (
    <Grid
      container
      direction="column"
      justifyContent="center"
      alignItems="center"
      style={{ height: '100%' }}
    >
      <Grid item>
        <Typography variant="h4" align="center">
          {t('non_registered_human_title')}
        </Typography>
        <br />
        <Typography
          variant="h6"
          align="center"
          style={{ whiteSpace: 'pre-line' }}
        >
          {children ?? (
            <Trans i18nKey="non_registered_human_desc">
              {{ webhook: name }}
            </Trans>
          )}
        </Typography>
        <br />
        <Typography variant="h6" align="center">
          {t('try_again_later')}
        </Typography>
      </Grid>
    </Grid>
  )
}
