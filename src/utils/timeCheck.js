// @ts-check
import SunCalc from 'suncalc'

/**
 *
 * @param {number} lat
 * @param {number} lon
 * @returns
 */
export function timeCheck(lat, lon) {
  const date = new Date()
  const times = SunCalc.getTimes(date, lat, lon)
  switch (true) {
    case date > times.dawn && date < times.sunriseEnd:
      return 'dawn'
    case date > times.sunsetStart && date < times.dusk:
      return 'dusk'
    case date > times.dusk || date < times.dawn:
      return 'night'
    default:
      return 'day'
  }
}
