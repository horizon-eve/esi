var request = require('request')
var cfg = require('./config')

var spec
var apis = {}

request({
    url: cfg.esi.swagger_url,
    json: true
}, function (error, response, body) {
    if (error) console.log(error)
    if (response.statusCode === 200) {
        reProcessEsiSpec(body)
    }
})

function reProcessEsiSpec(body) {
    spec = body
    var paths = Object.keys(spec.paths)
    paths.forEach(function(p) {
        var path = spec.paths[p]
        Object.keys(path).forEach(function(method) {
            var api = path[method]
            api.method = method
            api.path = p
            if (apis[api.operationId]) console.log('non unique ESI operationId ' + api.operationId)
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
        callback(op, api, params, body)
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
