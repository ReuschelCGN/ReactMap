import * as React from 'react'
import Box from '@mui/material/Box'
import DialogContent from '@mui/material/DialogContent'
import Typography from '@mui/material/Typography'
import { useTranslation } from 'react-i18next'
import ExpandMoreIcon from '@mui/icons-material/ExpandMore'
import Collapse from '@mui/material/Collapse'
import IconButton from '@mui/material/IconButton'
import Utility from '@services/Utility'
import { useMemory } from '@hooks/useMemory'
import { useLayoutStore } from '@hooks/useLayoutStore'
import { useStorage } from '@hooks/useStorage'
import useFilter from '@hooks/useFilter'
import Header from '@components/layout/general/Header'
import Footer from '@components/layout/general/Footer'
import { applyToAll } from '@services/filtering/applyToAll'
import useGetAvailable from '@hooks/useGetAvailable'

import OptionsContainer from '../dialogs/filters/OptionsContainer'
import { VirtualGrid } from './VirtualGrid'
import { GenericSearch } from '../drawer/ItemSearch'
import { applyToAllWebhooks, useWebhookStore } from '../dialogs/webhooks/store'

/**
 * @template {import('@rm/types').AdvCategories} T
 * @param {{
 *  category: T
 *  webhookCategory?: string
 *  tempFilters: import('@rm/types').AllFilters[T]
 *  children: (index: number, key: string) => React.ReactNode
 *  categories?: import('@rm/types').Available[]
 *  title: string
 *  titleAction: () => void
 *  extraButtons?: import('@components/layout/general/Footer').FooterButton[]
 * }} props
 */
export default function Menu({
  category,
  webhookCategory,
  tempFilters,
  children,
  categories,
  title,
  titleAction,
  extraButtons,
}) {
  useGetAvailable(category)

  Utility.analytics(`/advanced/${category}`)

  const isMobile = useMemory((s) => s.isMobile)
  const { t } = useTranslation()
  const menus = useStorage((state) => state.menus)

  const [filterDrawer, setFilterDrawer] = React.useState(false)

  const { filteredArr, count } = useFilter(
    tempFilters,
    menus,
    category,
    webhookCategory,
    categories,
  )

  const Options = React.useMemo(
    () => (
      <OptionsContainer
        countTotal={count.total}
        countShow={count.show}
        category={category}
        categories={categories}
      />
    ),
    [category, categories, count.total, count.show],
  )

  const footerButtons = React.useMemo(
    () =>
      /** @type {import('@components/layout/general/Footer').FooterButton[]} */ ([
        {
          name: 'help',
          action: () =>
            useLayoutStore.setState({ help: { open: true, category } }),
          icon: 'HelpOutline',
        },
        {
          name: '',
          disabled: true,
        },
        {
          name: 'apply_to_all',
          action: () =>
            (webhookCategory ? useWebhookStore : useLayoutStore).setState({
              [webhookCategory ? 'advanced' : 'advancedFilter']: {
                open: true,
                id: 'global',
                category: webhookCategory || category,
                selectedIds: filteredArr,
              },
            }),
          icon:
            category === 'pokemon' || webhookCategory ? 'Tune' : 'FormatSize',
        },
        {
          name: 'disable_all',
          action: () =>
            webhookCategory
              ? applyToAllWebhooks(false, filteredArr)
              : applyToAll({ enabled: false }, category, filteredArr),
          icon: 'Clear',
          color: 'error',
        },
        {
          name: 'enable_all',
          action: () =>
            webhookCategory
              ? applyToAllWebhooks(true, filteredArr)
              : applyToAll(
                  { enabled: true },
                  category,
                  filteredArr,
                  !webhookCategory,
                ),
          icon: 'Check',
          color: 'success',
        },
        ...(extraButtons ?? []),
      ]),
    [category, webhookCategory, extraButtons, filteredArr, tempFilters],
  )

  return (
    <>
      <Header
        titles={title}
        action={titleAction}
        names={[webhookCategory || category]}
      />
      <DialogContent className="container" sx={{ p: 0, minHeight: '75vh' }}>
        {!isMobile && <Box className="column-25">{Options}</Box>}
        <Box p={1} className="column-75">
          <Box pb={1} display="flex">
            <GenericSearch
              field={`searches.${category}Advanced`}
              label={t(`search_${category}`, t(`search_${category}s`))}
            />
            {isMobile && (
              <IconButton onClick={() => setFilterDrawer((prev) => !prev)}>
                <ExpandMoreIcon
                  className={filterDrawer ? 'expanded' : 'closed'}
                />
              </IconButton>
            )}
          </Box>
          <Box>
            {isMobile && <Collapse in={filterDrawer}>{Options}</Collapse>}
            {filteredArr.length ? (
              <VirtualGrid data={filteredArr} xs={4} md={2}>
                {children}
              </VirtualGrid>
            ) : (
              <Box
                className="flex-center"
                flex="1 1 auto"
                whiteSpace="pre-line"
              >
                <Typography variant="h6" align="center">
                  {t('no_filter_results')}
                </Typography>
              </Box>
            )}
          </Box>
        </Box>
      </DialogContent>
      <Footer options={footerButtons} role="dialog_filter_footer" />
    </>
  )
}
