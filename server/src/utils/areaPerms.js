// @ts-check
const config = require('@rm/config')

/**
 * Check if an area name matches a pattern (supports wildcards like _*)
 * @param {string} areaName
 * @param {string} pattern
 * @returns {boolean}
 */
function matchesPattern(areaName, pattern) {
  // If pattern contains *, treat it as a wildcard
  if (pattern.includes('*')) {
    const regexPattern = pattern.replace(/\*/g, '.*')
    const regex = new RegExp(`^${regexPattern}$`, 'i')
    return regex.test(areaName)
  }
  // Otherwise, exact match
  return areaName.toLowerCase() === pattern.toLowerCase()
}

/**
 * @param {string[]} roles
 * @returns {string[]}
 */
function areaPerms(roles) {
  const areaRestrictions = config.getSafe('authentication.areaRestrictions')
  const areas = config.getSafe('areas')

  const perms = []
  for (let i = 0; i < roles.length; i += 1) {
    for (let j = 0; j < areaRestrictions.length; j += 1) {
      if (areaRestrictions[j].roles.includes(roles[i])) {
        if (areaRestrictions[j].areas.length) {
          for (let k = 0; k < areaRestrictions[j].areas.length; k += 1) {
            const pattern = areaRestrictions[j].areas[k]
            
            // Check if pattern contains wildcard
            if (pattern.includes('*')) {
              // Match all areas against the wildcard pattern
              const allAreaNames = Array.from(areas.names)
              for (const areaName of allAreaNames) {
                if (matchesPattern(areaName, pattern) && !perms.includes(areaName)) {
                  perms.push(areaName)
                }
              }
              // Also check areas with parents
              for (const [parentName, childAreas] of Object.entries(areas.withoutParents)) {
                if (matchesPattern(parentName, pattern)) {
                  perms.push(...childAreas.filter(area => !perms.includes(area)))
                }
              }
            } else {
              // Exact match (original logic)
              if (areas.names.has(pattern)) {
                perms.push(pattern)
              } else if (areas.withoutParents[pattern]) {
                perms.push(...areas.withoutParents[pattern])
              }
            }
          }
        } else {
          return []
        }
      }
    }
  }
  return [...new Set(perms)]
}

module.exports = { areaPerms }
