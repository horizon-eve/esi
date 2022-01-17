var request = require('request')
var cfg = require('./config')
const fs = require('fs')

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

function execute(op, params, callback) {
    var api = apis[op]
    request({
        url: 'https://' + spec.host + spec.basePath + path_params(api.path, params),
        method: api.method,
        json: true
    },
        function (error, response, body) {
        if (error) {
            console.log('error: ' + error)
            console.log('response: ' + response)
            return
        }

        callback(op, api, params, body, response)
    })
}

function path_params(path, params) {
    var res = path
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
