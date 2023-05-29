/* eslint-disable no-restricted-syntax */
const { Model, raw, ref } = require('objection')
const i18next = require('i18next')
const fs = require('fs')
const { resolve } = require('path')
const { default: getDistance } = require('@turf/distance')
const { point } = require('@turf/helpers')

const { Event } = require('../services/initialization')
const legacyFilter = require('../services/legacyFilter')
const {
  devOptions: { queryDebug },
  api: {
    searchResultsLimit,
    pvp: { minCp: pvpMinCp, leagues, reactMapHandlesPvp, leagueObj },
    queryLimits,
  },
  map: { distanceUnit },
} = require('../services/config')
const getAreaSql = require('../services/functions/getAreaSql')
const filterRTree = require('../services/functions/filterRTree')
const { Pvp } = require('../services/initialization')
const fetchJson = require('../services/api/fetchJson')

const levelCalc =
  'IFNULL(IF(cp_multiplier < 0.734, ROUND(58.35178527 * cp_multiplier * cp_multiplier - 2.838007664 * cp_multiplier + 0.8539209906), ROUND(171.0112688 * cp_multiplier - 95.20425243)), NULL)'
const ivCalc =
  'IFNULL((individual_attack + individual_defense + individual_stamina) / 0.45, NULL)'
const keys = [
  'iv',
  'cp',
  'level',
  'atk_iv',
  'def_iv',
  'sta_iv',
  'gender',
  'xxs',
  'xxl',
  ...leagues.map((league) => league.name),
]
const madKeys = {
  iv: raw(ivCalc),
  level: raw(levelCalc),
  atk_iv: 'individual_attack',
  def_iv: 'individual_defense',
  sta_iv: 'individual_stamina',
  gender: 'pokemon.gender',
  cp: 'cp',
}

const getMadSql = (q) =>
  q
    .leftJoin('trs_spawn', 'pokemon.spawnpoint_id', 'trs_spawn.spawnpoint')
    .leftJoin(
      'pokemon_display',
      'pokemon.encounter_id',
      'pokemon_display.encounter_id',
    )
    .select([
      '*',
      ref('pokemon.encounter_id').castTo('CHAR').as('id'),
      'pokemon.latitude AS lat',
      'pokemon.longitude AS lon',
      'individual_attack AS atk_iv',
      'individual_defense AS def_iv',
      'individual_stamina AS sta_iv',
      'height',
      'pokemon.form',
      'pokemon.gender',
      'pokemon.costume',
      'pokemon_display.pokemon AS display_pokemon_id',
      'pokemon_display.form AS ditto_form',
      'weather_boosted_condition AS weather',
      raw('IF(calc_endminsec IS NOT NULL, 1, NULL)').as(
        'expire_timestamp_verified',
      ),
      raw('Unix_timestamp(disappear_time)').as('expire_timestamp'),
      raw('Unix_timestamp(last_modified)').as('updated'),
      raw(ivCalc).as('iv'),
      raw(levelCalc).as('level'),
    ])

module.exports = class Pokemon extends Model {
  static get tableName() {
    return 'pokemon'
  }

  static async getAll(
    perms,
    args,
    { isMad, pvpV2, mem, hasSize, hasHeight, secret },
  ) {
    const { iv: ivs, pvp, areaRestrictions } = perms
    const {
      onlyStandard,
      onlyIvOr,
      // onlyXlKarp,
      // onlyXsRat,
      onlyZeroIv,
      onlyHundoIv,
      onlyPvpMega,
      onlyLinkGlobal,
      ts,
      onlyAreas = [],
    } = args.filters
    let queryPvp = false
    const safeTs = ts || Math.floor(Date.now() / 1000)

    // quick check to make sure no Pokemon are returned when none are enabled for users with only Pokemon perms
    if (!ivs && !pvp) {
      const noPokemonSelect = Object.keys(args.filters).find(
        (x) => x.charAt(0) !== 'o',
      )
      if (!noPokemonSelect) return []
    }

    const pvpCheck = (pkmn, league, min, max) => {
      const rankCheck = pkmn.rank <= max && pkmn.rank >= min
      const cpCheck = pvpV2 || reactMapHandlesPvp || pkmn.cp >= pvpMinCp[league]
      const megaCheck = !pkmn.evolution || onlyPvpMega
      const capCheck =
        pvpV2 || reactMapHandlesPvp
          ? pkmn.capped || args.filters[`onlyPvp${pkmn.cap}`]
          : true
      return rankCheck && cpCheck && megaCheck && capCheck
    }

    const getRanks = (league, data, filterId) => {
      const [min, max] = getMinMax(filterId, league)
      let best = 4096
      const filtered = data.filter((pkmn) => {
        const valid = pvpCheck(pkmn, league, min, max)
        if (valid && pkmn.rank < best) best = pkmn.rank
        return valid
      })
      return { filtered, best }
    }

    // decide if the Pokemon passes global or local filter
    const getMinMax = (filterId, league) => {
      const globalOn = !arrayCheck(onlyIvOr, league)
      const specificFilter = args.filters[filterId]
      const [globalMin, globalMax] = onlyIvOr[league]
      let min = 0
      let max = 0
      if (specificFilter && !arrayCheck(specificFilter, league)) {
        const [pkmnMin, pkmnMax] = specificFilter[league]
        if (globalOn) {
          min = pkmnMin <= globalMin ? pkmnMin : globalMin
          max = pkmnMax >= globalMax ? pkmnMax : globalMax
        } else {
          min = pkmnMin
          max = pkmnMax
        }
      } else if (globalOn) {
        min = globalMin
        max = globalMax
      }
      return [min, max]
    }

    // parse PVP JSON(s)
    const getParsedPvp = (pokemon) => {
      if (pokemon.pvp)
        return typeof pokemon.pvp === 'string'
          ? JSON.parse(pokemon.pvp)
          : pokemon.pvp

      const parsed = {}
      const pvpKeys = ['great', 'ultra']
      pvpKeys.forEach((league) => {
        if (pokemon[`pvp_rankings_${league}_league`]) {
          parsed[league] = JSON.parse(pokemon[`pvp_rankings_${league}_league`])
        }
      })
      return parsed
    }

    // checks if filters are set to default and skips them if so
    const arrayCheck = (filter, key) =>
      Array.isArray(filter[key])
        ? filter[key]?.every((v, i) => v === onlyStandard[key][i])
        : filter[key] === onlyStandard[key]

    // cycles through the above arrayCheck
    const getRelevantKeys = (filter) => {
      const relevantKeys = []
      keys.forEach((key) => {
        if (!arrayCheck(filter, key)) {
          relevantKeys.push(key)
        }
      })
      return relevantKeys
    }

    // generates specific SQL for each slider that isn't set to default, along with perm checks
    const generateSql = (queryBase, filter, relevant) => {
      queryBase.andWhere((pkmn) => {
        relevant.forEach((key) => {
          switch (key) {
            case 'xxs':
            case 'xxl':
              if (hasSize) {
                pkmn.orWhere('pokemon.size', key === 'xxl' ? 5 : 1)
              }
              break
            case 'gender':
              pkmn.andWhere('pokemon.gender', filter[key])
              break
            case 'cp':
            case 'level':
            case 'atk_iv':
            case 'def_iv':
            case 'sta_iv':
            case 'iv':
              if (ivs) {
                pkmn.andWhereBetween(isMad ? madKeys[key] : key, filter[key])
              }
              break
            default:
              if (pvp) {
                queryPvp = true
                if (
                  !relevant.includes('iv') &&
                  !relevant.includes('level') &&
                  !relevant.includes('atk_iv') &&
                  !relevant.includes('def_iv') &&
                  !relevant.includes('sta_iv') &&
                  !relevant.includes('cp') &&
                  !relevant.includes('xxs') &&
                  !relevant.includes('xxl')
                ) {
                  // doesn't return everything if only pvp stats for individual pokemon
                  pkmn.whereNull('pokemon_id')
                }
              }
              break
          }
        })
      })
    }

    const globalCheck = (pkmn) =>
      onlyLinkGlobal ? args.filters[`${pkmn.pokemon_id}-${pkmn.form}`] : true
    // query builder
    const query = this.query()

    if (!mem) {
      if (isMad) {
        getMadSql(query)
      } else {
        query.select(['*', hasSize && !hasHeight ? 'size AS height' : 'size'])
      }
      query
        .where(
          isMad ? 'disappear_time' : 'expire_timestamp',
          '>=',
          isMad ? this.knex().fn.now() : safeTs,
        )
        .andWhereBetween(isMad ? 'pokemon.latitude' : 'lat', [
          args.minLat,
          args.maxLat,
        ])
        .andWhereBetween(isMad ? 'pokemon.longitude' : 'lon', [
          args.minLon,
          args.maxLon,
        ])
        .andWhere((ivOr) => {
          for (const [pkmn, filter] of Object.entries(args.filters)) {
            if (pkmn.includes('-')) {
              const relevantFilters = getRelevantKeys(filter)
              const [id, form] = pkmn.split('-')
              ivOr.orWhere((poke) => {
                if (id === '132') {
                  poke.where('pokemon_id', id)
                } else {
                  poke.where('pokemon_id', id).andWhere('pokemon.form', form)
                }
                if (relevantFilters.length) {
                  generateSql(poke, filter, relevantFilters)
                }
              })
            } else if (pkmn === 'onlyIvOr' && (ivs || pvp)) {
              const relevantFilters = getRelevantKeys(filter)
              if (relevantFilters.length) {
                generateSql(ivOr, filter, relevantFilters)
              } else {
                ivOr.whereNull('pokemon_id')
              }
            }
          }
          // if (onlyXlKarp) {
          //   ivOr.orWhere('pokemon_id', 129).andWhere('weight', '>=', 13.125)
          // }
          // if (onlyXsRat) {
          //   ivOr.orWhere('pokemon_id', 19).andWhere('weight', '<=', 2.40625)
          // }
          if (onlyZeroIv && ivs) {
            ivOr.orWhere(isMad ? raw(ivCalc) : 'iv', 0)
          }
          if (onlyHundoIv && ivs) {
            ivOr.orWhere(isMad ? raw(ivCalc) : 'iv', 100)
          }
        })
      if (!getAreaSql(query, areaRestrictions, onlyAreas, isMad, 'pokemon')) {
        return []
      }
    }

    const nullOrValue = (filter) => {
      const {
        // eslint-disable-next-line no-unused-vars
        enabled,
        // eslint-disable-next-line no-unused-vars
        size,
        // eslint-disable-next-line no-unused-vars
        adv,
        iv,
        atk_iv,
        def_iv,
        sta_iv,
        cp,
        level,
        gender,
        xxs,
        xxl,
        ...rest
      } = filter
      const localPvp = pvp
        ? Object.fromEntries(
            Object.entries(rest).map(([league, values]) => {
              if (
                Array.isArray(values) &&
                values.some((val, i) => val !== onlyStandard[league][i])
              ) {
                return [league, values]
              }
              return [league, undefined]
            }),
          )
        : undefined
      return {
        iv: ivs && !arrayCheck(filter, 'iv') ? iv : undefined,
        atk_iv: ivs && !arrayCheck(filter, 'atk_iv') ? atk_iv : undefined,
        def_iv: ivs && !arrayCheck(filter, 'def_iv') ? def_iv : undefined,
        sta_iv: ivs && !arrayCheck(filter, 'sta_iv') ? sta_iv : undefined,
        cp: ivs && !arrayCheck(filter, 'cp') ? cp : undefined,
        level: ivs && !arrayCheck(filter, 'level') ? level : undefined,
        gender: ivs && !arrayCheck(filter, 'gender') ? gender : undefined,
        pvp: Object.keys(localPvp || {}).length ? localPvp : undefined,
        additional: {
          include_everything: !getRelevantKeys(filter).length,
          include_xxs: xxs || false,
          include_xxl: xxl || false,
        },
      }
    }
    const results = await this.evalQuery(
      mem ? `${mem}/api/pokemon/scan` : null,
      mem
        ? JSON.stringify({
            min: {
              latitude: args.minLat,
              longitude: args.minLon,
            },
            max: {
              latitude: args.maxLat,
              longitude: args.maxLon,
            },
            center: {
              latitude: 0,
              longitude: 0,
            },
            searchIds: [],
            // standard: onlyStandard,
            global: {
              ...nullOrValue(onlyIvOr, 'global'),
              additional: {
                include_xxs: onlyIvOr.xxs || false,
                include_xxl: onlyIvOr.xxl || false,
                include_zeroiv: onlyZeroIv,
                include_hundoiv: onlyHundoIv,
                include_everything: false,
              },
            },
            limit: queryLimits.pokemon + queryLimits.pokemonPvp,
            // xlKarp: onlyXlKarp,
            // xsRat: onlyXsRat,
            // pvpMega: onlyPvpMega,
            // pvp50: args.filters.onlyPvp50,
            // pvp51: args.filters.onlyPvp51,
            // linkGlobal: onlyLinkGlobal,
            filters: Object.fromEntries(
              Object.entries(args.filters)
                .filter(([k]) => k.includes('-'))
                .map(([k, v]) => [k, nullOrValue(v, k)]),
            ),
          })
        : query.limit(queryLimits.pokemon),
      'POST',
      secret,
    )

    const finalResults = []
    const pvpResults = []
    const listOfIds = []

    // form checker
    results.forEach((pkmn) => {
      if (!mem || filterRTree(pkmn, areaRestrictions, onlyAreas)) {
        let noPvp = true
        if (pkmn.pokemon_id === 132 && !pkmn.ditto_form) {
          pkmn.ditto_form = pkmn.form
          pkmn.form = Event.masterfile.pokemon[pkmn.pokemon_id].defaultFormId
        }
        if (!pkmn.seen_type) {
          if (pkmn.spawn_id === null) {
            pkmn.seen_type = pkmn.pokestop_id ? 'nearby_stop' : 'nearby_cell'
          } else {
            pkmn.seen_type = 'encounter'
          }
        }
        if (
          pvp &&
          (pkmn.pvp_rankings_great_league ||
            pkmn.pvp_rankings_ultra_league ||
            pkmn.pvp ||
            (isMad && reactMapHandlesPvp && pkmn.cp))
        ) {
          noPvp = false
          listOfIds.push(pkmn.id)
          pvpResults.push(pkmn)
        }
        if (noPvp && globalCheck(pkmn)) {
          pkmn.changed = !!pkmn.changed
          pkmn.expire_timestamp_verified = !!pkmn.expire_timestamp_verified
          finalResults.push(pkmn)
        }
      }
    })

    // second query for pvp
    if (queryPvp && (!isMad || reactMapHandlesPvp)) {
      const pvpQuery = this.query()
      if (isMad) {
        getMadSql(pvpQuery)
        pvpQuery.select(raw(true).as('pvpCheck'))
      } else {
        pvpQuery.select(['*', raw(true).as('pvpCheck')])
      }
      pvpQuery
        .where(
          isMad ? 'disappear_time' : 'expire_timestamp',
          '>=',
          isMad ? this.knex().fn.now() : safeTs,
        )
        .andWhereBetween(isMad ? 'pokemon.latitude' : 'lat', [
          args.minLat,
          args.maxLat,
        ])
        .andWhereBetween(isMad ? 'pokemon.longitude' : 'lon', [
          args.minLon,
          args.maxLon,
        ])
      if (isMad && listOfIds.length) {
        pvpQuery.whereRaw(
          `pokemon.encounter_id NOT IN ( ${listOfIds.join(',')} )`,
        )
      } else {
        pvpQuery.whereNotIn('id', listOfIds)
      }
      if (reactMapHandlesPvp) {
        pvpQuery.whereNotNull('cp')
      } else if (pvpV2) {
        pvpQuery.whereNotNull('pvp')
      } else {
        pvpQuery.andWhere((pvpBuilder) => {
          pvpBuilder
            .whereNotNull('pvp_rankings_great_league')
            .orWhereNotNull('pvp_rankings_ultra_league')
        })
      }
      if (
        !getAreaSql(pvpQuery, areaRestrictions, onlyAreas, isMad, 'pokemon')
      ) {
        return []
      }
      pvpResults.push(
        ...(await this.evalQuery(
          mem,
          pvpQuery.limit(queryLimits.pokemonPvp - results.length),
        )),
      )
    }

    // filter pokes with pvp data
    pvpResults.forEach((pkmn) => {
      const parsed = reactMapHandlesPvp
        ? Pvp.resultWithCache(pkmn, safeTs)
        : getParsedPvp(pkmn)
      const filterId = `${pkmn.pokemon_id}-${pkmn.form}`
      pkmn.cleanPvp = {}
      pkmn.bestPvp = 4096
      if (pkmn.pokemon_id === 132 && !pkmn.ditto_form && pkmn.pvpCheck) {
        pkmn.ditto_form = pkmn.form
        pkmn.form = Event.masterfile.pokemon[pkmn.pokemon_id].defaultFormId
      }
      if (!pkmn.seen_type) pkmn.seen_type = 'encounter'
      Object.keys(parsed).forEach((league) => {
        if (leagueObj[league]) {
          const { filtered, best } = getRanks(league, parsed[league], filterId)
          if (filtered.length) {
            pkmn.cleanPvp[league] = filtered
            if (best < pkmn.bestPvp) pkmn.bestPvp = best
          }
        }
      })
      if (
        (Object.keys(pkmn.cleanPvp).length || !pkmn.pvpCheck) &&
        globalCheck(pkmn)
      ) {
        pkmn.changed = !!pkmn.changed
        pkmn.expire_timestamp_verified = !!pkmn.expire_timestamp_verified
        finalResults.push(pkmn)
      }
    })
    return finalResults
  }

  static async evalQuery(mem, query, method = 'POST', secret = '') {
    if (queryDebug) {
      if (!fs.existsSync(resolve(__dirname, './queries'))) {
        fs.mkdirSync(resolve(__dirname, './queries'), { recursive: true })
      }
      if (mem && typeof query === 'string') {
        fs.writeFileSync(
          resolve(__dirname, './queries', `${Date.now()}.json`),
          query,
        )
      } else if (typeof query === 'object') {
        fs.writeFileSync(
          resolve(__dirname, './queries', `${Date.now()}.txt`),
          query.toKnexQuery().toString(),
        )
      }
    }
    const results = await (mem
      ? fetchJson(mem, {
          method,
          headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-Golbat-Secret': secret || undefined,
          },
          body: query,
        })
      : query)
    return results || []
  }

  static async getLegacy(
    perms,
    args,
    { isMad, hasSize, hasHeight, mem, secret },
  ) {
    const ts = Math.floor(new Date().getTime() / 1000)
    const query = this.query()
      .where(
        isMad ? 'disappear_time' : 'expire_timestamp',
        '>=',
        isMad ? this.knex().fn.now() : ts,
      )
      .andWhereBetween(isMad ? 'pokemon.latitude' : 'lat', [
        args.minLat,
        args.maxLat,
      ])
      .andWhereBetween(isMad ? 'pokemon.longitude' : 'lon', [
        args.minLon,
        args.maxLon,
      ])
    if (isMad) {
      getMadSql(query)
    } else {
      query.select(['*', hasSize && !hasHeight ? 'size AS height' : 'size'])
    }
    if (
      !getAreaSql(
        query,
        perms.areaRestrictions,
        args.filters.onlyAreas,
        isMad,
        'pokemon',
      )
    ) {
      return []
    }
    const results = await this.evalQuery(
      mem ? `${mem}/api/pokemon/scan` : null,
      mem
        ? JSON.stringify({
            min: {
              latitude: args.minLat,
              longitude: args.minLon,
            },
            max: {
              latitude: args.maxLat,
              longitude: args.maxLon,
            },
            global: {
              expert: args.filters.onlyIvOr.adv,
            },
            limit: queryLimits.pokemon + queryLimits.pokemonPvp,
            filters: Object.fromEntries(
              Object.entries(args.filters)
                .filter(([k, v]) => k.includes('-') && v.enabled)
                .map(([k, v]) => [k, { expert: v.adv }]),
            ),
          })
        : query,
      'POST',
      secret,
    )
    return legacyFilter(
      results.filter(
        (item) =>
          !mem ||
          filterRTree(item, perms.areaRestrictions, args.filters.onlyAreas),
      ),
      args,
      perms,
      ts,
    )
  }

  // eslint-disable-next-line no-unused-vars
  static async getAvailable({ isMad, mem, secret }) {
    const ts = Math.floor(Date.now() / 1000)
    const available = await this.evalQuery(
      mem ? `${mem}/api/pokemon/available` : null,
      mem
        ? undefined
        : this.query()
            .select(['pokemon_id AS id', 'form'])
            .count('pokemon_id AS count')
            .where(
              isMad ? 'disappear_time' : 'expire_timestamp',
              '>=',
              isMad ? this.knex().fn.now() : ts,
            )
            .groupBy('pokemon_id', 'form')
            .orderBy('pokemon_id', 'form'),
      'GET',
      secret,
    )
    return {
      available: available.map((pkmn) => `${pkmn.id}-${pkmn.form}`),
      rarity: Object.fromEntries(
        available.map((pkmn) => [`${pkmn.id}-${pkmn.form}`, pkmn.count]),
      ),
    }
  }

  // eslint-disable-next-line no-unused-vars
  static getOne(id, { isMad, mem, secret }) {
    return this.evalQuery(
      mem ? `${mem}/api/pokemon/id/${id}` : null,
      mem
        ? undefined
        : this.query()
            .select([
              isMad ? 'latitude AS lat' : 'lat',
              isMad ? 'longitude AS lon' : 'lon',
            ])
            .where(isMad ? 'encounter_id' : 'id', id)
            .first(),
      'GET',
      secret,
    )
  }

  static async search(perms, args, { isMad, mem, secret }, distance) {
    const { search, locale, onlyAreas = [] } = args
    const pokemonIds = Object.keys(Event.masterfile.pokemon).filter((pkmn) =>
      i18next.t(`poke_${pkmn}`, { lng: locale }).toLowerCase().includes(search),
    )
    const safeTs = args.ts || Math.floor(Date.now() / 1000)
    const query = this.query()
      .select(['pokemon_id', distance])
      .whereIn('pokemon_id', pokemonIds)
      .andWhere(
        isMad ? 'disappear_time' : 'expire_timestamp',
        '>=',
        isMad ? this.knex().fn.now() : safeTs,
      )
      .limit(searchResultsLimit)
      .orderBy('distance')
    if (isMad) {
      query.select([
        ref('encounter_id').castTo('CHAR').as('id'),
        'latitude AS lat',
        'longitude AS lon',
        'form',
        'gender',
        'costume',
        raw(ivCalc).as('iv'),
      ])
    } else {
      query.select([
        'id',
        'lat',
        'lon',
        'form',
        'costume',
        'gender',
        'iv',
        'shiny',
      ])
    }
    if (!getAreaSql(query, perms.areaRestrictions, onlyAreas, isMad)) {
      return []
    }
    const results = await this.evalQuery(
      mem ? `${mem}/api/pokemon/search` : null,
      mem
        ? JSON.stringify({
            center: {
              latitude: args.lat,
              longitude: args.lon,
            },
            limit: searchResultsLimit * 4,
            searchIds: pokemonIds.map((id) => +id),
            global: {},
            filters: {},
          })
        : query,
      'POST',
      secret,
    )
    return results
      .filter(
        (item, i) =>
          i < searchResultsLimit &&
          (!mem || filterRTree(item, perms.areaRestrictions, onlyAreas)),
      )
      .map((poke) => ({
        ...poke,
        iv: perms.iv && poke.iv ? poke.iv.toFixed(2) : null,
        distance:
          poke.distance ||
          getDistance(
            point([poke.lon, poke.lat]),
            point([args.lon, args.lat]),
            {
              units:
                distanceUnit.toLowerCase() === 'km' ||
                distanceUnit.toLowerCase() === 'kilometers'
                  ? 'kilometers'
                  : 'miles',
            },
          ).toFixed(2),
      }))
  }
}
