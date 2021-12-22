
const default_config = require('../config/default-config.json');
const environment = process.env.NODE_ENV || 'development';
if (!default_config[environment]) throw 'no config for env: ' + environment

let effective_config

if (process.env.CONFIG_OVERRIDE) {
  let config_override = JSON.parse(process.env.CONFIG_OVERRIDE)
  if (!config_override[environment]) throw new Error('no config override for env: ' + environment)
  effective_config = bindEnvironment(deepMerge(default_config[environment], config_override[environment]))
} else {
  effective_config = bindEnvironment(default_config[environment])
}

function bindEnvironment(config) {
  if (typeof config !== 'object' ) return false
  for (const prop in config) {
    if (!Object.prototype.hasOwnProperty.call(config, prop)) continue // take into consideration only object's own properties.
    let val = config[prop]
    if (typeof val === 'object') {
      if (val.ENV) {
        config[prop] = process.env[val.ENV]
      } else {
        bindEnvironment(val)
      }
    } else if (val.concat) {
      // Walk through array
      for (const el in val) {
        bindEnvironment(el)
      }
    }
  }
  return config
}

// Credits: curveball from stackoverflow.com (https://stackoverflow.com/users/7355533/curveball)
function deepMerge (target, source) {
  if (typeof target !== 'object' || typeof source !== 'object') return false // target or source or both ain't objects, merging doesn't make sense
  for (const prop in source) {
    if (!Object.prototype.hasOwnProperty.call(source, prop)) continue // take into consideration only object's own properties.
    if (prop in target) { // handling merging of two properties with equal names
      if (typeof target[prop] !== 'object') {
        target[prop] = source[prop]
      } else {
        if (typeof source[prop] !== 'object') {
          target[prop] = source[prop]
        } else {
          if (target[prop].concat && source[prop].concat) { // two arrays get concatenated
            target[prop] = target[prop].concat(source[prop])
          } else { // two objects get merged recursively
            target[prop] = deepMerge(target[prop], source[prop])
          }
        }
      }
    } else { // new properties get added to target
      target[prop] = source[prop]
    }
  }
  return target
}

module.exports = effective_config
