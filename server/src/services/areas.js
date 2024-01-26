// @ts-check
const { default: center } = require('@turf/center')
const fs = require('fs')
const { resolve } = require('path')
const { default: fetch } = require('node-fetch')
const RTree = require('rtree')

const config = require('@rm/config')
const { log, HELPERS } = require('@rm/logger')
const { setCache, getCache } = require('./cache')

/** @type {import("@rm/types").RMGeoJSON} */
const DEFAULT_RETURN = { type: 'FeatureCollection', features: [] }

/** @type {import("@rm/types").RMGeoJSON} */
const manualGeojson = {
  type: 'FeatureCollection',
  features: config
    .getSafe('manualAreas')
    .filter((area) =>
      ['lat', 'lon', 'name'].every((k) => k in area && !area.hidden),
    )
    .map((area) => {
      const { lat, lon, ...rest } = area
      return {
        type: 'Feature',
        properties: {
          center: [lat, lon],
          manual: true,
          key: rest.parent ? `${rest.parent}-${rest.name}` : rest.name,
          ...rest,
        },
        geometry: {
          type: 'Polygon',
          coordinates: [[[lon, lat]]],
        },
      }
    }),
}

/**
 * @param {string} location
 * @returns {Promise<import("@rm/types").RMGeoJSON>}
 */
const getGeojson = async (location) => {
  try {
    if (location.startsWith('http')) {
      log.info(HELPERS.areas, 'Loading Kōji URL', location)
      return fetch(location, {
        headers: {
          Authorization: `Bearer ${config.getSafe(
            'api.kojiOptions.bearerToken',
          )}`,
        },
      })
        .then((res) => res.json())
        .then(async (res) => {
          if (res?.data) {
            log.info(HELPERS.areas, 'Caching', location, 'from Kōji')
            await setCache(`${location.replace(/\//g, '__')}.json`, res.data)
            return res.data
          }
          return DEFAULT_RETURN
        })
        .catch((err) => {
          log.error(
            HELPERS.areas,
            'Failed to fetch Kōji geojson, attempting to read from backup',
            err,
          )
          const cached = getCache(`${location.replace(/\//g, '__')}.json`)
          if (cached) {
            log.info(HELPERS.areas, 'Reading from koji_backups for', location)
            return cached
          }
          log.warn(HELPERS.areas, 'No backup found for', location)
          return DEFAULT_RETURN
        })
    }
    if (fs.existsSync(resolve(__dirname, `../configs/${location}`))) {
      return JSON.parse(
        fs.readFileSync(resolve(__dirname, `../configs/${location}`), 'utf-8'),
      )
    }
  } catch (e) {
    log.warn(HELPERS.areas, 'Issue with getting the geojson', e)
  }
  return DEFAULT_RETURN
}

/**
 * Load each areas.json
 * @param {string} fileName
 * @param {string} [domain]
 * @returns {Promise<import("@rm/types").RMGeoJSON>}
 */
const loadScanPolygons = async (fileName, domain) => {
  try {
    const geojson = await getGeojson(fileName)
    return {
      ...geojson,
      features: [
        ...manualGeojson.features.filter(
          (f) => !f.properties.domain || f.properties.domain === domain,
        ),
        ...geojson.features.map((f) => ({
          ...f,
          properties: {
            ...f.properties,
            key: f.properties.parent
              ? `${f.properties.parent}-${f.properties.name}`
              : f.properties.name,
            center: /** @type {[number,number]} */ (
              center(f).geometry.coordinates.reverse()
            ),
          },
        })),
      ].sort((a, b) =>
        a.properties.name
          ? a.properties.name.localeCompare(b.properties.name)
          : 0,
      ),
    }
  } catch (e) {
    log.warn(
      HELPERS.areas,
      `Failed to load ${fileName} for ${
        domain || 'map'
      }. Using empty areas.json`,
      e,
    )
    return DEFAULT_RETURN
  }
}

/**
 *
 * @param {Record<string, import("@rm/types").RMGeoJSON>} scanAreas
 * @returns {import("@rm/types").RMGeoJSON}
 */
const loadAreas = (scanAreas) => {
  try {
    /** @type {import("@rm/types").RMGeoJSON} */
    const normalized = { type: 'FeatureCollection', features: [] }
    Object.values(scanAreas).forEach((area) => {
      if (area?.features.length) {
        normalized.features.push(
          ...area.features.filter((f) => !f.properties.manual),
        )
      }
    })
    return normalized
  } catch (err) {
    if (
      config
        .getSafe('authentication.areaRestrictions')
        .some((rule) => rule.roles.length)
    ) {
      log.warn(
        HELPERS.areas,
        'Area restrictions disabled - `areas.json` file is missing or broken.',
      )
    }
    return DEFAULT_RETURN
  }
}

/** @param {import("@rm/types").RMGeoJSON} featureCollection */
const parseAreas = (featureCollection) => {
  /** @type {Record<string, import("@rm/types").RMGeoJSON['features'][number]['geometry']>} */
  const polygons = {}
  /** @type {Set<string>} */
  const names = new Set()
  /** @type {Record<string, string[]>} */
  const withoutParents = {}

  if (!featureCollection) {
    return { names, polygons, withoutParents }
  }
  featureCollection.features.forEach((feature) => {
    const { name, key, manual } = feature.properties
    if (name && !manual && feature.geometry.type.includes('Polygon')) {
      const { coordinates } = feature.geometry
      if (feature.geometry.type === 'Polygon') {
        coordinates.forEach((polygon, i) => {
          if (
            polygon[0][0] !== polygon[polygon.length - 1][0] ||
            polygon[0][1] !== polygon[polygon.length - 1][1]
          ) {
            log.warn(HELPERS.areas, 'Polygon not closed', name, `Index (${i})`)
            polygon.push(polygon[0])
          }
        })
      } else {
        coordinates.forEach((poly, i) => {
          poly.forEach((polygon, j) => {
            if (
              polygon[0][0] !== polygon[polygon.length - 1][0] ||
              polygon[0][1] !== polygon[polygon.length - 1][1]
            ) {
              log.warn(
                HELPERS.areas,
                'MultiPolygon contains unclosed Polygon',
                name,
                `Polygon (${i})`,
                `Index (${j})`,
              )
              polygon.push(polygon[0])
            }
          })
        })
      }
      feature.geometry.coordinates = coordinates
      polygons[key] = feature.geometry
      names.add(key)
      if (withoutParents[name]) {
        withoutParents[name].push(key)
      } else {
        withoutParents[name] = [key]
      }
    }
  })
  return { names, withoutParents, polygons }
}

/**
 * @param {Record<string, import("@rm/types").RMGeoJSON>} scanAreas
 * @returns
 */
const buildAreas = (scanAreas) => {
  const scanAreasMenu = Object.fromEntries(
    Object.entries(scanAreas).map(([domain, featureCollection]) => {
      const parents = {
        '': {
          children:
            /** @type {Pick<import('@rm/types').RMFeature, 'properties'>[]} */ ([]),
          name: '',
          details:
            /** @type {Pick<import('@rm/types').RMFeature, 'properties'> | null} */ (
              null
            ),
        },
      }

      const noHiddenFeatures = {
        ...featureCollection,
        features: featureCollection.features.filter(
          (f) => !f.properties.hidden,
        ),
      }
      // Finds unique parents and determines if the parents have their own properties
      noHiddenFeatures.features.forEach((feature) => {
        if (feature.properties.parent) {
          const found = featureCollection.features.find(
            (area) => area.properties.name === feature.properties.parent,
          )
          parents[feature.properties.parent] = {
            name: feature.properties.parent,
            details: found && {
              properties: found.properties,
            },
            children: [],
          }
        }
      })

      // Finds the children of each parent
      noHiddenFeatures.features.forEach((feature) => {
        if (feature.properties.parent) {
          parents[feature.properties.parent].children.push({
            properties: feature.properties,
          })
        } else if (!parents[feature.properties.name]) {
          parents[''].children.push({ properties: feature.properties })
        }
      })

      return [
        domain,
        Object.values(parents).sort((a, b) => a.name.localeCompare(b.name)),
      ]
    }),
  )
  const scanAreasObj = Object.fromEntries(
    Object.values(scanAreas)
      .flatMap((areas) => areas.features)
      .map((feature) => [feature.properties.key, feature]),
  )

  const myRTree = RTree()
  myRTree.geoJSON({
    type: 'FeatureCollection',
    features: Object.values(scanAreasObj).filter(
      (f) =>
        !f.properties.manual &&
        f.properties.key &&
        f.geometry.type.includes('Polygon'),
    ),
  })

  const raw = loadAreas(scanAreas)
  log.info(HELPERS.areas, 'Loaded areas')
  return {
    scanAreas,
    scanAreasMenu,
    scanAreasObj,
    raw,
    myRTree,
    ...parseAreas(raw),
  }
}

const loadLatestAreas = async () => {
  const fileName = config.getSafe('map.general.geoJsonFileName')

  /** @type {Record<string, import("@rm/types").RMGeoJSON>} */
  const scanAreas = {
    main: await loadScanPolygons(fileName),
    ...Object.fromEntries(
      await Promise.all(
        config
          .getSafe('multiDomains')
          .map(async (d) => [
            d.general?.geoJsonFileName ? d.domain.replaceAll('.', '_') : 'main',
            await loadScanPolygons(d.general?.geoJsonFileName || fileName),
          ]),
      ),
    ),
  }
  return buildAreas(scanAreas)
}

const loadCachedAreas = () => {
  const fileName = config.getSafe('map.general.geoJsonFileName')

  /** @type {Record<string, import("@rm/types").RMGeoJSON>} */
  const scanAreas = {
    main: getCache(`${fileName.replace(/\//g, '__')}.json`, DEFAULT_RETURN),
    ...Object.fromEntries(
      config
        .getSafe('multiDomains')
        .map((d) => [
          d.general?.geoJsonFileName ? d.domain.replaceAll('.', '_') : 'main',
          getCache(d.general?.geoJsonFileName || fileName, DEFAULT_RETURN),
        ]),
    ),
  }
  return buildAreas(scanAreas)
}

module.exports = {
  loadLatestAreas,
  loadCachedAreas,
}
