import * as React from 'react'
import { darken } from '@mui/material/styles'
import Button from '@mui/material/Button'
import { useTranslation } from 'react-i18next'
import { I } from '../general/I'

export default function DiscordLogin({
  href = '/auth/discord/callback',
  text = 'login',
  size = 'large',
}) {
  const { t } = useTranslation()

  return (
    <Button
      variant="contained"
      sx={{
        bgcolor: 'rgb(114,136,218)',
        '&:hover': {
          bgcolor: darken('rgb(114,136,218)', 0.2),
        },
      }}
      size={size}
      href={href}
      startIcon={<I className="fab fa-discord" size={size} />}
    >
      {t(text)}
    </Button>
  )
}
