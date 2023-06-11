const fs = require('fs')
const { resolve } = require('path')
const { rarity: customRarity, api } = require('../src/services/config')
const { log, HELPERS } = require('../src/services/logger')
const fetchJson = require('../src/services/api/fetchJson')
const defaultRarity = require('../src/data/defaultRarity.json')

const rarityObj = {}
Object.entries(defaultRarity).forEach(([tier, pokemon]) => {
  if (customRarity?.[tier]?.length) {
    customRarity[tier].forEach((mon) => (rarityObj[mon] = tier))
  } else {
    pokemon.forEach((mon) => (rarityObj[mon] = tier))
  }
})

const generate = async (save = false, historicRarity = {}, dbRarity = {}) => {
  try {
    if (!api.pogoApiEndpoints.masterfile)
      throw new Error('No masterfile endpoint')

    const masterfile = await fetchJson(api.pogoApiEndpoints.masterfile)

    const newMf = {
      ...masterfile,
      pokemon: Object.fromEntries(
        Object.values(masterfile.pokemon).map((pokemon) => {
          const { legendary, mythical, ultraBeast } = pokemon
          const historic =
            historicRarity[pokemon.pokedexId.toString()] || 'never'

          let rarity =
            (dbRarity.size
              ? dbRarity[`${pokemon.pokedexId}-${pokemon.defaultFormId}`]
              : rarityObj[pokemon.pokedexId]) || 'never'
          if (legendary) rarity = 'legendary'
          if (mythical) rarity = 'mythical'
          if (ultraBeast) rarity = 'ultraBeast'
          if (rarityObj[pokemon.pokedexId] === 'regional') rarity = 'regional'

          const forms = Object.fromEntries(
            Object.entries(pokemon.forms || {}).map(([formId, form]) => [
              formId,
              {
                ...form,
                rarity:
                  +formId === pokemon.defaultFormId
                    ? rarity
                    : dbRarity[`${pokemon.pokedexId}-${formId}`] || 'never',
              },
            ]),
          )
          return [pokemon.pokedexId, { ...pokemon, forms, rarity, historic }]
        }),
      ),
    }

    if (save) {
      fs.writeFileSync(
        resolve(`${__dirname}/../src/data/masterfile.json`),
        JSON.stringify(newMf, null, 2),
        'utf8',
        () => {},
      )
    }
    return newMf
  } catch (e) {
    log.warn(
      HELPERS.masterfile,
      'Unable to generate new masterfile, using existing.',
      e,
    )
  }
}

module.exports.generate = generate

if (require.main === module) {
  generate(true).then(() =>
    log.info(HELPERS.masterfile, 'Masterfile generated'),
  )
}
