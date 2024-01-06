import React, { useState } from 'react'
import { Dialog, DialogContent, Drawer, Grid, Typography } from '@mui/material'
import { useTranslation } from 'react-i18next'

import Utility from '@services/Utility'
import { useStore, useStatic, useLayoutStore } from '@hooks/useStore'
import useFilter from '@hooks/useFilter'

import ReactWindow from '@components/layout/general/ReactWindow'
import Header from '@components/layout/general/Header'
import Footer from '@components/layout/general/Footer'
import SlotSelection from '../dialogs/filters/SlotSelection'
import OptionsContainer from '../dialogs/filters/OptionsContainer'
import Help from '../dialogs/tutorial/Advanced'
import WebhookAdvanced from '../dialogs/webhooks/WebhookAdv'
import AdvSearch from '../dialogs/filters/AdvSearch'

export default function Menu({
  category,
  Tile,
  webhookCategory,
  filters,
  tempFilters,
  setTempFilters,
  categories,
  title,
  titleAction,
  extraButtons,
}) {
  Utility.analytics(`/advanced/${category}`)

  const isMobile = useStatic((s) => s.isMobile)
  const isTablet = useStatic((s) => s.isTablet)

  const menus = useStore((state) => state.menus)
  const { t } = useTranslation()
  const Icons = useStatic((s) => s.Icons)

  let columnCount = isTablet ? 3 : 5
  if (isMobile) columnCount = 1

  const [filterDrawer, setFilterDrawer] = useState(false)
  const [slotsMenu, setSlotsMenu] = useState({
    open: false,
    id: 0,
  })
  const [search, setSearch] = useState('')
  const [helpDialog, setHelpDialog] = useState(false)
  const [webhook, setWebhook] = useState({
    open: false,
    id: '',
  })

  const { filteredObj, filteredArr, count } = useFilter(
    tempFilters,
    menus,
    search,
    category,
    webhookCategory,
    categories,
  )

  const selectAllOrNone = (show) => {
    const newObj = {}
    Object.entries(filteredObj).forEach(([key, item]) => {
      newObj[key] = { ...item, enabled: show }
      if (key.startsWith('t') && key.charAt(1) != 0 && !webhookCategory) {
        Object.assign(newObj, Utility.generateSlots(key, show, tempFilters))
      }
    })
    setTempFilters({ ...tempFilters, ...newObj })
  }

  const toggleDrawer = React.useCallback(
    (open) => (event) => {
      if (
        event.type === 'keydown' &&
        (event.key === 'Tab' || event.key === 'Shift')
      ) {
        return
      }
      setFilterDrawer(open)
    },
    [],
  )

  const toggleWebhook = (open, id, newFilters) => (event) => {
    if (
      event.type === 'keydown' &&
      (event.key === 'Tab' || event.key === 'Shift')
    ) {
      return
    }
    if (id === 'global' && !open && newFilters) {
      const wildCards = (() => {
        switch (webhookCategory) {
          case 'raid':
            return ['r90']
          case 'egg':
            return ['e90']
          case 'gym':
            return ['t4']
          case 'invasion':
            return ['i0']
          default:
            return ['0-0']
        }
      })()
      if (newFilters.everything_individually !== false) {
        Object.keys(filteredObj).forEach((item) => {
          if (!wildCards.includes(item)) {
            filteredObj[item] = {
              ...tempFilters[item],
              ...newFilters,
              enabled: true,
            }
          }
        })
      } else {
        wildCards.forEach((item) => {
          filteredObj[item] = {
            ...tempFilters[item],
            ...newFilters,
            enabled: true,
          }
        })
      }
      setTempFilters({ ...tempFilters, ...filteredObj, [id]: newFilters })
    } else if (id && newFilters && !open) {
      setTempFilters({
        ...tempFilters,
        [id]: { ...tempFilters[id], ...newFilters, enabled: true },
      })
    }
    setWebhook({ open, id: id ?? '' })
  }

  const toggleSlotsMenu = (open, id, newFilters) => (event) => {
    if (
      event.type === 'keydown' &&
      (event.key === 'Tab' || event.key === 'Shift')
    ) {
      return
    }
    if (open) {
      setSlotsMenu({
        open,
        id,
      })
    } else if (newFilters) {
      setSlotsMenu({ open })
      setTempFilters({ ...newFilters })
    } else {
      setSlotsMenu({ open })
    }
  }

  const Options = React.useMemo(
    () => (
      <OptionsContainer
        countTotal={count.total}
        countShow={count.show}
        category={category}
        toggleDrawer={toggleDrawer}
        categories={categories}
      />
    ),
    [category, categories, count.total, count.show, toggleDrawer],
  )

  const footerButtons = React.useMemo(
    () => [
      {
        name: 'help',
        action: () => setHelpDialog((prev) => !prev),
        icon: 'HelpOutline',
      },
      {
        name: 'openFilter',
        action: toggleDrawer(true),
        icon: 'Ballot',
        mobileOnly: true,
      },
      {
        name: 'apply_to_all',
        action: webhookCategory
          ? toggleWebhook(true, 'global')
          : () =>
              useLayoutStore.setState({
                advancedFilter: {
                  open: true,
                  id: 'global',
                  category,
                  selectedIds: Object.keys(filteredObj),
                },
              }),
        icon: category === 'pokemon' || webhookCategory ? 'Tune' : 'FormatSize',
      },
      {
        name: 'disable_all',
        action: () => selectAllOrNone(false),
        icon: 'Clear',
        color: 'error',
      },
      {
        name: 'enable_all',
        action: () => selectAllOrNone(true),
        icon: 'Check',
        color: 'success',
      },
      ...(extraButtons ?? []),
    ],
    [category, webhookCategory, extraButtons, filteredObj, tempFilters],
  )

  return (
    <>
      <Header
        titles={title}
        action={titleAction}
        names={[webhookCategory || category]}
      />
      <DialogContent style={{ padding: '8px 5px', height: '100%' }}>
        <Grid container spacing={1}>
          {!isMobile && (
            <Grid item sm={3} style={{ height: '75vh', overflow: 'auto' }}>
              {Options}
            </Grid>
          )}
          <Grid
            container
            item
            xs={12}
            sm={9}
            direction="column"
            style={isMobile ? { height: '85vh' } : {}}
          >
            <AdvSearch
              search={search}
              setSearch={setSearch}
              category={category}
            />
            {filteredArr.length ? (
              <div style={{ flex: '1 1 auto' }}>
                <ReactWindow
                  columnCount={columnCount}
                  length={filteredArr.length}
                  flex
                  offset={0}
                  data={{
                    isMobile,
                    tileItem: filteredArr,
                    tempFilters,
                    setTempFilters,
                    toggleSlotsMenu,
                    type: category,
                    toggleWebhook,
                    webhookCategory,
                    standard: filters.standard,
                    Icons,
                  }}
                  Tile={Tile}
                />
              </div>
            ) : (
              <div style={{ flex: '1 1 auto' }}>
                <Grid
                  container
                  alignItems="center"
                  justifyContent="center"
                  direction="column"
                  style={{ height: '100%' }}
                >
                  <Grid item style={{ whiteSpace: 'pre-line' }}>
                    <Typography variant="h6" align="center">
                      {t('no_filter_results')}
                    </Typography>
                  </Grid>
                </Grid>
              </div>
            )}
          </Grid>
        </Grid>
      </DialogContent>
      <Footer options={footerButtons} role="dialog_filter_footer" />
      <Drawer
        anchor="bottom"
        sx={{ zIndex: 10000 }}
        open={filterDrawer}
        onClose={toggleDrawer(false)}
      >
        {Options}
      </Drawer>
      <Dialog open={slotsMenu.open} onClose={toggleSlotsMenu(false)}>
        <SlotSelection
          teamId={slotsMenu.id}
          toggleSlotsMenu={toggleSlotsMenu}
          tempFilters={tempFilters}
          isMobile={isMobile}
        />
      </Dialog>
      <Dialog open={helpDialog} onClose={() => setHelpDialog(false)}>
        <Help
          toggleHelp={() => setHelpDialog(!helpDialog)}
          category={category}
          isMobile={isMobile}
        />
      </Dialog>
      <Dialog
        open={!!(webhook.open && webhook.id)}
        fullWidth={!isMobile}
        fullScreen={isMobile}
        onClose={toggleWebhook(false)}
      >
        <WebhookAdvanced
          id={webhook.id}
          category={webhookCategory}
          isMobile={isMobile}
          toggleWebhook={toggleWebhook}
          tempFilters={tempFilters[webhook.id]}
        />
      </Dialog>
    </>
  )
}
