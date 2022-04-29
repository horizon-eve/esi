var request = require('request')
var cfg = require('./config')
const fs = require('fs')
const cache = require('../src/cache')
const e = require('express')

var spec
var apis = {}

{
    let file = fs.readFileSync(cfg.esi.swagger_path)
    reProcessEsiSpec(JSON.parse(file))
}

function reProcessEsiSpec(content) {
    spec = content
    var paths = Object.keys(spec.paths)
    paths.forEach(function(p) {
        var path = spec.paths[p]
        Object.keys(path).forEach(function(method) {
            var api = path[method]
            api.method = method
            api.path = p
            if (apis[api.operationId]) console.log('non unique ESI operationId ' + api.operationId)
            api.method = method.toLowerCase()
            apis[api.operationId] = api
        })
    })
    console.log('ESI: Loaded ' + Object.keys(apis).length + ' endpoints for ESI API v' + spec.info.version)
}

function execute(query, done) {
    // need auth?
    const api = query.api
    // get data from cache
    cache.get(query, (errors, data, client, release) => {
        if (errors)
            return done(errors)
        if (!client) {
            return done(null, data)
        }
        // get data from esi
        request({
              url: `https://${spec.host}${spec.basePath}${path_params(query)}`,
              qs: query_params(query),
              method: api.method,
              headers: esi_headers(query),
              json: true
          },
          function (error, response, body) {
              cache.update(query, response, body, client, release)
              if (error)
                  return done(error)
              if (body.error)
                  return done({status: 500, message: body.error})

              done(null, body)
          })
    })
}

function esi_headers(query) {
    if (query.character_token) {
        return {Authorization: `Bearer ${query.character_token}`}
    }
    return {}
}

function query_params(query) {
    const res = {}
    const params = query.params
    const api = query.api
    if (params) {
        Object.keys(params).filter(p => p.toLowerCase() !== 'token').forEach(function(key) {
            let pdef = api.parameters.find(p => (p.name === key && p.in === 'query') || p.$ref === `#/parameters/${key}`)
            if (pdef) {
                if (pdef.$ref) {
                    pdef = spec.parameters[key]
                }
                if (pdef && pdef.in === 'query') {
                    res[pdef.name] = params[pdef.name]
                }
            }
        })
    }
    return res
}

function path_params(query) {
    let res = query.api.path
    const params = query.params
    if (params) {
        Object.keys(params).forEach(function(key) {
            res = res.replace('{' + key + '}', params[key])
        })
    }
    return res
}

module.exports.execute = execute
module.exports.spec = spec
module.exports.apis = apis
