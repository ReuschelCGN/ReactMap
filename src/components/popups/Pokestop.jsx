import React, { Fragment, useState, useEffect } from 'react'
import ExpandMore from '@mui/icons-material/ExpandMore'
import MoreVert from '@mui/icons-material/MoreVert'
import {
  Grid,
  Typography,
  Collapse,
  IconButton,
  Divider,
  TableRow,
  TableCell,
  Table,
  TableBody,
  styled,
} from '@mui/material'

import { useTranslation, Trans } from 'react-i18next'

import ErrorBoundary from '@components/ErrorBoundary'
import { Check, Help } from '@components/layout/general/Icons'
import { useStore, useStatic } from '@hooks/useStore'
import Utility from '@services/Utility'
import { getBadge } from '@services/functions/getBadge'

import Dropdown from './common/Dropdown'
import TimeTile from './common/TimeTile'
import Navigation from './common/Navigation'
import Coords from './common/Coords'
import Title from './common/Title'
import HeaderImage from './common/HeaderImage'
import Timer from './common/Timer'
import PowerUp from './common/PowerUp'
import NameTT from './common/NameTT'

export default function PokestopPopup({
  pokestop,
  ts,
  hasLure,
  hasInvasion,
  hasQuest,
  hasEvent,
  Icons,
  userSettings,
  config,
}) {
  const { t } = useTranslation()
  const { pokestops: perms } = useStatic((state) => state.ui)
  const { lure_expire_timestamp, lure_id, invasions, events } = pokestop

  useEffect(() => {
    const has = { hasLure, hasQuest, hasInvasion }
    Utility.analytics(
      'Popup',
      Object.keys(has).filter((a) => Boolean(has[a])),
      'Pokestop',
    )
  }, [])

  const plainPokestop = !hasLure && !hasQuest && !hasInvasion && !hasEvent

  return (
    <ErrorBoundary noRefresh style={{}} variant="h5">
      <Grid
        container
        direction="row"
        justifyContent="space-evenly"
        alignItems="center"
        style={{ width: 200 }}
      >
        {!plainPokestop && (
          <Grid item xs={3} style={{ textAlign: 'center' }}>
            <HeaderImage
              Icons={Icons}
              alt={pokestop.name}
              url={pokestop.url}
              arScanEligible={pokestop.ar_scan_eligible}
            />
          </Grid>
        )}
        <Grid item xs={plainPokestop ? 10 : 7}>
          <Title backup={t('unknown_pokestop')}>{pokestop.name}</Title>
        </Grid>
        <MenuActions
          pokestop={pokestop}
          perms={perms}
          hasInvasion={hasInvasion}
          hasQuest={hasQuest}
          hasLure={hasLure}
          t={t}
          ts={ts}
        />
        <Grid item xs={12} style={{ textAlign: 'center' }}>
          {plainPokestop ? (
            <>
              <HeaderImage
                Icons={Icons}
                alt={pokestop.name}
                url={pokestop.url}
                arScanEligible={pokestop.ar_scan_eligible}
                large
              />
              <PowerUp {...pokestop} />
            </>
          ) : (
            <Grid container justifyContent="center" alignItems="center">
              <PowerUp
                {...pokestop}
                divider={hasInvasion || hasQuest || hasLure}
              />
              {hasQuest &&
                pokestop.quests.map((quest, index) => (
                  <Fragment key={quest.with_ar}>
                    {index ? (
                      <Divider light flexItem className="popup-divider" />
                    ) : null}
                    <RewardInfo
                      quest={quest}
                      Icons={Icons}
                      config={config}
                      t={t}
                    />
                    <QuestConditions
                      quest={quest}
                      t={t}
                      userSettings={userSettings}
                    />
                  </Fragment>
                ))}
              {hasLure && (
                <>
                  {hasQuest && (
                    <Divider light flexItem className="popup-divider" />
                  )}
                  <TimeTile
                    expandKey={`l${lure_id}`}
                    expireTime={lure_expire_timestamp}
                    icon={Icons.getPokestops(lure_id)}
                    until
                    caption={t(`lure_${lure_id}`)}
                    tt={`lure_${lure_id}`}
                  />
                </>
              )}
              {hasInvasion && perms.invasions && (
                <>
                  {invasions.map((invasion, index) => (
                    <Fragment
                      key={`${invasion.grunt_type}-${invasion.incident_expire_timestamp}`}
                    >
                      {index || hasQuest || hasLure ? (
                        <Divider light flexItem className="popup-divider" />
                      ) : null}
                      <TimeTile
                        expandKey={`i${invasion.grunt_type}`}
                        expireTime={invasion.incident_expire_timestamp}
                        icon={Icons.getInvasions(
                          invasion.grunt_type,
                          invasion.confirmed,
                        )}
                        until
                        tt={
                          invasion.grunt_type === 44 && !invasion.confirmed
                            ? [`grunt_a_${invasion.grunt_type}`, ' / ', 'decoy']
                            : `grunt_a_${invasion.grunt_type}`
                        }
                      >
                        <Invasion invasion={invasion} Icons={Icons} t={t} />
                      </TimeTile>
                    </Fragment>
                  ))}
                </>
              )}
              {hasEvent && (
                <>
                  {(hasQuest || hasLure || hasInvasion) && (
                    <Divider light flexItem className="popup-divider" />
                  )}
                  {events.map(({ showcase_rankings = {}, ...event }, index) => {
                    const { contest_entries = [], ...showcase } =
                      showcase_rankings
                    return (
                      <Fragment
                        key={`${event.display_Type}-${event.event_expire_timestamp}`}
                      >
                        {index ? (
                          <Divider light flexItem className="popup-divider" />
                        ) : null}
                        <TimeTile
                          expireTime={event.event_expire_timestamp}
                          expandKey={
                            event.showcase_pokemon_id
                              ? `event_${event.display_type}`
                              : undefined
                          }
                          icon={
                            event.showcase_pokemon_id ? (
                              <NameTT
                                key={event.showcase_pokemon_id}
                                id={[`poke_${event.showcase_pokemon_id}`]}
                              >
                                <div className="invasion-reward">
                                  <img
                                    className="invasion-reward"
                                    alt="invasion reward"
                                    src={Icons.getPokemon(
                                      event.showcase_pokemon_id,
                                    )}
                                  />
                                  <img
                                    className="invasion-reward-shadow"
                                    alt="shadow"
                                    src={Icons.getEventStops(
                                      event.display_type,
                                    )}
                                  />
                                </div>
                              </NameTT>
                            ) : (
                              Icons.getEventStops(event.display_type)
                            )
                          }
                          until
                          tt={t(
                            `display_type_${event.display_type}`,
                            t('unknown_event'),
                          )}
                        >
                          <Showcase
                            {...showcase}
                            showcase_ranking_standard={
                              event.showcase_ranking_standard
                            }
                          >
                            <Table
                              size="small"
                              className="table-invasion three-quarters-width"
                            >
                              <TableBody>
                                {(contest_entries || []).map((position) => (
                                  <ShowcaseEntry
                                    key={position.rank}
                                    {...position}
                                  />
                                ))}
                              </TableBody>
                            </Table>
                          </Showcase>
                        </TimeTile>
                      </Fragment>
                    )
                  })}
                </>
              )}
            </Grid>
          )}
        </Grid>
        <Footer pokestop={pokestop} perms={perms} />
        {perms.allPokestops && (
          <ExtraInfo
            pokestop={pokestop}
            userSettings={userSettings}
            t={t}
            ts={ts}
          />
        )}
      </Grid>
    </ErrorBoundary>
  )
}

const MenuActions = ({
  pokestop,
  perms,
  hasInvasion,
  hasQuest,
  hasLure,
  t,
}) => {
  const masterfile = useStatic((state) => state.masterfile)
  const filters = useStore((state) => state.filters)

  const [anchorEl, setAnchorEl] = useState(false)

  const { id, lure_id, quests, invasions } = pokestop

  const handleClick = (event) => {
    setAnchorEl(event.currentTarget)
  }

  const handleClose = () => {
    setAnchorEl(null)
  }

  const handleHide = () => {
    setAnchorEl(null)
    useStatic.setState((prev) => ({ hideList: [...prev.hideList, id] }))
  }

  const setState = (key) => {
    useStore.setState((prev) => ({
      filters: {
        ...prev.filters,
        pokestops: {
          ...prev.filters.pokestops,
          filter: {
            ...prev.filters.pokestops.filter,
            [key]: {
              ...prev.filters.pokestops.filter[key],
              enabled: false,
            },
          },
        },
      },
    }))
    useStatic.setState((prev) => ({ excludeList: [...prev.excludeList, key] }))
  }

  const excludeLure = () => {
    setAnchorEl(null)
    setState(`l${lure_id}`)
  }

  const excludeQuest = (i) => {
    setAnchorEl(null)
    setState(quests[i].key)
  }

  const excludeInvasion = (i) => {
    setAnchorEl(null)
    setState(`i${invasions[i].grunt_type}`)
  }

  const handleTimer = () => {
    setAnchorEl(null)
    useStatic.setState((prev) => {
      if (prev.includes(id)) {
        return { timerList: prev.timerList.filter((x) => x !== id) }
      }
      return { timerList: [...prev.timerList, id] }
    })
  }

  const options = [{ name: 'hide', action: handleHide }]

  if (perms.quests && hasQuest) {
    quests.forEach((quest, i) => {
      let reward = ''
      switch (quest.quest_reward_type) {
        case 2:
          reward = t(`item_${quest.quest_item_id}`)
          break
        case 3:
          reward = `${t('stardust')} x${quest.stardust_amount}`
          break
        case 4:
          reward = `${t(`poke_${quest.candy_pokemon_id}`)} ${t('candy')}`
          break
        case 7:
          reward = t(`poke_${quest.quest_pokemon_id}`)
          break
        case 9:
          reward = `${t(`poke_${quest.xl_candy_pokemon_id}`)} ${t('xl')}`
          break
        case 12:
          reward = `${t(`poke_${quest.mega_pokemon_id}`)} x${quest.mega_amount}`
          break
        default:
          reward = t(`quest_reward_${quest.quest_reward_type}`)
          break
      }
      options.push({
        key: `${reward}-${quest.with_ar}`,
        name: <Trans i18nKey="exclude_quest_multi">{{ reward }}</Trans>,
        action: () => excludeQuest(i),
      })
    })
  }

  if ((perms.invasions && hasInvasion) || (perms.lures && hasLure)) {
    if (hasInvasion) {
      invasions.forEach((invasion, i) => {
        if (filters.pokestops.filter[`i${invasion.grunt_type}`]?.enabled) {
          options.push({
            key: `${invasion.grunt_type}-${invasion.incident_expire_timestamp}`,
            name: (
              <Trans i18nKey="exclude_invasion_multi">
                {{ invasion: t(`grunt_a_${invasion.grunt_type}`) }}
              </Trans>
            ),
            action: () => excludeInvasion(i),
          })
        }
        const reference = masterfile.invasions[invasion.grunt_type]
        if (reference) {
          const encounters = new Set()
          if (
            invasion.slot_1_pokemon_id &&
            reference.firstReward &&
            filters.pokestops.filter[
              `a${invasion.slot_1_pokemon_id}-${invasion.slot_1_form}`
            ]?.enabled
          ) {
            encounters.add(
              `a${invasion.slot_1_pokemon_id}-${invasion.slot_1_form}`,
            )
          }
          if (
            invasion.slot_2_pokemon_id &&
            reference.secondReward &&
            filters.pokestops.filter[
              `a${invasion.slot_2_pokemon_id}-${invasion.slot_2_form}`
            ]?.enabled
          ) {
            encounters.add(
              `a${invasion.slot_2_pokemon_id}-${invasion.slot_2_form}`,
            )
          }
          if (
            invasion.slot_3_pokemon_id &&
            reference.thirdReward &&
            filters.pokestops.filter[
              `a${invasion.slot_3_pokemon_id}-${invasion.slot_3_form}`
            ]?.enabled
          ) {
            encounters.add(
              `a${invasion.slot_3_pokemon_id}-${invasion.slot_3_form}`,
            )
          }
          if (encounters.size)
            options.push(
              ...[...encounters].map((x) => ({
                key: x,
                name: (
                  <Trans i18nKey="exclude_quest_multi">
                    {{ reward: t(`poke_${x.slice(1).split('-')[0]}`) }}
                  </Trans>
                ),
                action: () => {
                  setAnchorEl(null)
                  setState(x)
                },
              })),
            )
        }
      })
    }
    if (hasLure) {
      options.push({ name: 'exclude_lure', action: excludeLure })
    }
    options.push({ name: 'timer', action: handleTimer })
  }
  return (
    <Grid item xs={2} style={{ textAlign: 'right' }}>
      <IconButton aria-haspopup="true" onClick={handleClick} size="large">
        <MoreVert />
      </IconButton>
      <Dropdown
        anchorEl={anchorEl}
        handleClose={handleClose}
        options={options}
      />
    </Grid>
  )
}

const RewardInfo = ({ quest, Icons, config, t }) => {
  const { src, amount, tt } = Utility.getRewardInfo(quest, Icons)

  return (
    <Grid item xs={3} style={{ textAlign: 'center', position: 'relative' }}>
      <NameTT id={tt}>
        <img
          src={src}
          style={{ maxWidth: 35, maxHeight: 35 }}
          alt={tt}
          onError={(e) => {
            e.target.onerror = null
            e.target.src =
              'https://raw.githubusercontent.com/WatWowMap/wwm-uicons-webp/main/misc/0.webp'
          }}
        />
      </NameTT>
      {!!amount && (
        <div
          className="search-amount-holder"
          style={{ fontSize: 'medium', bottom: 20 }}
        >
          x{amount}
        </div>
      )}
      <Typography variant="caption" className="ar-task" noWrap>
        {config.questMessage
          ? config.questMessage
          : t(`ar_quest_${Boolean(quest.with_ar)}`)}
      </Typography>
    </Grid>
  )
}

const QuestConditions = ({ quest, t, userSettings }) => {
  const { i18n } = useTranslation()
  const {
    quest_task,
    quest_type,
    quest_target,
    quest_conditions,
    quest_title,
  } = quest

  if (userSettings.madQuestText && quest_task) {
    return (
      <Grid item xs={9} style={{ textAlign: 'center' }}>
        <Typography variant="caption">{quest_task}</Typography>
      </Grid>
    )
  }

  if (quest_title && !quest_title.includes('geotarget')) {
    const normalized = `quest_title_${quest_title.toLowerCase()}`
    if (i18n.exists(normalized)) {
      return (
        <Grid item xs={9} style={{ textAlign: 'center' }}>
          <Typography variant="caption">
            <Trans i18nKey={normalized}>{{ amount_0: quest_target }}</Trans>
          </Typography>
        </Grid>
      )
    }
  }

  const [type1, type2] = Utility.parseConditions(quest_conditions)
  const primaryCondition = (
    <Typography variant="caption">
      <Trans i18nKey={`quest_${quest_type}`}>{{ amount: quest_target }}</Trans>
    </Typography>
  )
  const getQuestConditions = (qType, qInfo) => {
    const key = `quest_condition_${qType}_formatted`
    switch (qType) {
      case 1:
        return (
          <Trans i18nKey={key}>
            {{
              types: qInfo.pokemon_type_ids.map((id) => t(`poke_type_${id}`)),
            }}
          </Trans>
        )
      case 2:
        return (
          <Trans i18nKey={key}>
            {{ pokemon: qInfo.pokemon_ids.map((id) => ` ${t(`poke_${id}`)}`) }}
          </Trans>
        )
      case 7:
        return (
          <Trans i18nKey={key}>
            {{ levels: qInfo.raid_levels.map((id) => id) }}
          </Trans>
        )
      case 11:
        return (
          <Trans i18nKey={key}>{{ item: t(`item_${qInfo.item_id}`) }}</Trans>
        )
      case 8:
      case 14:
        return qInfo.throw_type_id ? (
          <Trans i18nKey={key}>
            {{ throw_type: t(`throw_type_${qInfo.throw_type_id}`) }}
          </Trans>
        ) : (
          t('quest_condition_14')
        )
      case 26:
        return (
          <Trans i18nKey={key}>
            {{
              alignments: qInfo.alignment_ids.map((id) => t(`alignment_${id}`)),
            }}
          </Trans>
        )
      case 27:
        return (
          <Trans i18nKey={key}>
            {{
              categories: qInfo.character_category_ids.map((id) =>
                t(`character_category_${id}`),
              ),
            }}
          </Trans>
        )
      case 44:
        return <Trans i18nKey={key}>{{ time: qInfo.time }}</Trans>
      default:
        return t(`quest_condition_${qType}`)
    }
  }
  return (
    <Grid
      item
      xs={9}
      style={{ textAlign: 'center', maxHeight: 150, overflow: 'auto' }}
    >
      {primaryCondition}
      {type1 && (
        <>
          <br />
          <Typography variant="caption">
            {getQuestConditions(type1.type, type1.info)}
          </Typography>
        </>
      )}
      {type2 && (
        <>
          <br />
          <Typography variant="caption">
            {getQuestConditions(type2.type, type2.info)}
          </Typography>
        </>
      )}
    </Grid>
  )
}

const Footer = ({ pokestop, perms }) => {
  const open = useStore((state) => !!state.popups.extras)

  return (
    <Grid
      container
      item
      xs={12}
      justifyContent="space-evenly"
      alignItems="center"
    >
      <Grid item xs={3}>
        <Navigation lat={pokestop.lat} lon={pokestop.lon} />
      </Grid>
      {perms.allPokestops && (
        <Grid item xs={3} style={{ textAlign: 'center' }}>
          <IconButton
            className={open ? 'expanded' : 'closed'}
            onClick={() =>
              useStore.setState((prev) => ({
                popups: { ...prev.popups, extras: !open },
              }))
            }
            size="large"
          >
            <ExpandMore />
          </IconButton>
        </Grid>
      )}
    </Grid>
  )
}

const ExtraInfo = ({ pokestop, userSettings, t, ts }) => {
  const open = useStore((state) => state.popups.extras)
  const { last_modified_timestamp, updated } = pokestop

  const extraMetaData = [
    {
      description: 'last_seen',
      timer: <Timer expireTime={updated} />,
      data: Utility.dayCheck(ts, updated),
    },
    {
      description: 'last_modified',
      timer: <Timer expireTime={last_modified_timestamp} />,
      data: Utility.dayCheck(ts, last_modified_timestamp),
    },
  ]

  return (
    <Collapse in={open} timeout="auto" unmountOnExit>
      <Grid container alignItems="center" justifyContent="center">
        {extraMetaData.map((meta) => (
          <Fragment key={meta.description}>
            <Grid
              item
              xs={t('popup_pokestop_description_width')}
              style={{ textAlign: 'left' }}
            >
              <Typography variant="caption">{t(meta.description)}:</Typography>
            </Grid>
            <Grid
              item
              xs={t('popup_pokestop_seen_timer_width')}
              style={{ textAlign: 'right' }}
            >
              {meta.timer}
            </Grid>
            <Grid
              item
              xs={t('popup_pokestop_data_width')}
              style={{ textAlign: 'right' }}
            >
              <Typography variant="caption">{meta.data}</Typography>
            </Grid>
          </Fragment>
        ))}
        {userSettings.enablePokestopPopupCoords && (
          <Grid item xs={12} style={{ textAlign: 'center' }}>
            <Coords lat={pokestop.lat} lon={pokestop.lon} />
          </Grid>
        )}
      </Grid>
    </Collapse>
  )
}

const getRewardPercent = (grunt) => {
  if (grunt.type.startsWith('NPC')) {
    return {}
  }
  if (grunt.secondReward) {
    return { first: '85%', second: '15%' }
  }
  if (grunt.thirdReward) {
    return { third: '100%' }
  }
  if (grunt.firstReward) {
    return { first: '100%' }
  }
  return {}
}

const ShadowPokemon = ({ Icons, ...pkmn }) => {
  const src = Icons.getPokemon(
    pkmn.id,
    pkmn.form,
    0,
    pkmn.gender,
    pkmn.costumeId,
    1,
    pkmn.shiny,
  )
  return (
    <NameTT
      key={`${pkmn.id}_${pkmn.form}`}
      id={[pkmn.form ? `form_${pkmn.form}` : '', `poke_${pkmn.id}`]}
    >
      <div className="invasion-reward">
        <img className="invasion-reward" alt="invasion reward" src={src} />
        {!src.includes('_a1') && (
          <img
            className="invasion-reward-shadow"
            alt="shadow"
            src={Icons.getMisc('shadow')}
          />
        )}
      </div>
    </NameTT>
  )
}

const Invasion = ({ invasion, Icons, t }) => {
  const { invasions: invasionInfo } = useStatic((state) => state.masterfile)
  const encounterNum = { first: '#1', second: '#2', third: '#3' }

  return (
    <Grid container>
      <Grid item xs={9}>
        <Typography variant="h6" align="center">
          {t(`grunt_a_${invasion.grunt_type}`)}
        </Typography>
      </Grid>
      <Grid item xs={3} style={{ alignItems: 'center', display: 'flex' }}>
        {invasion.confirmed ? (
          <Check fontSize="medium" color="success" />
        ) : (
          <Help fontSize="medium" />
        )}
      </Grid>
      <Grid item xs={12}>
        <table className="table-invasion">
          <tbody>
            {Object.keys(
              invasionInfo[invasion.grunt_type]?.encounters || {},
            ).map((position, i) => {
              const id = invasion[`slot_${i + 1}_pokemon_id`]
              const form = invasion[`slot_${i + 1}_form`]
              return (
                <tr key={position}>
                  <td>{encounterNum[position]}</td>
                  <td>
                    {id ? (
                      <ShadowPokemon Icons={Icons} id={id} form={form} />
                    ) : (
                      invasionInfo[invasion.grunt_type].encounters[
                        position
                      ].map((data) => (
                        <ShadowPokemon
                          key={`${data.id}-${data.form}`}
                          Icons={Icons}
                          {...data}
                        />
                      ))
                    )}
                  </td>
                  <td>
                    {getRewardPercent(invasionInfo[invasion.grunt_type])[
                      position
                    ] || ''}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </Grid>
    </Grid>
  )
}

const Showcase = ({
  showcase_ranking_standard,
  total_entries,
  last_update,
  children,
}) => {
  const { t } = useTranslation()
  return (
    <Grid container>
      <Grid item xs={12}>
        <Typography variant="h6" align="center">
          {t(
            `context_category_${showcase_ranking_standard}`,
            t('unknown_event'),
          )}
        </Typography>
      </Grid>
      <Grid item xs={12}>
        {children}
      </Grid>
      <Grid item xs={6}>
        <Typography variant="subtitle2" align="center">
          {t(`total_entries`, 'Total Entries')}:
        </Typography>
      </Grid>
      <Grid item xs={6}>
        <Typography variant="subtitle2" align="center">
          {total_entries} / 150 {/* TODO: Read from GM */}
        </Typography>
      </Grid>
      <Grid item xs={6}>
        <Typography variant="subtitle2" align="center">
          {t(`last_updated`, 'Last Updated')}:
        </Typography>
      </Grid>
      <Grid item xs={6}>
        <Timer expireTime={last_update} />
      </Grid>
    </Grid>
  )
}

const NoBorderCell = styled(TableCell, {
  shouldForwardProp: (prop) => prop !== 'textAlign',
})(({ textAlign = 'right' }) => ({
  borderBottom: 'none',
  padding: 2,
  textAlign,
}))

const ShowcaseEntry = ({ rank, score }) => {
  const Icons = useStatic((s) => s.Icons)
  return (
    <TableRow>
      <NoBorderCell>
        <img src={Icons.getMisc(getBadge(rank))} alt="rank" height={20} />
      </NoBorderCell>
      <NoBorderCell textAlign="center">{score.toFixed(2)}</NoBorderCell>
    </TableRow>
  )
}
