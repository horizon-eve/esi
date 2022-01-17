const express = require('express');
const config = require('../bin/config')
const cors = require('cors')
const cache = require('../bin/cache')
const esi = require('../bin/esi')

const router = express.Router();

const corsOptions = { origin: config.server.cors.origin }

router.get('/*', cors(corsOptions), function (req, res) {
  process(req, res)
})
router.post('/*', cors(corsOptions), function (req, res) {
  process(req, res)
})
router.patch('/*', cors(corsOptions), function (req, res) {
  process(req, res)
})

router.delete('/*', cors(corsOptions), function (req, res) {
  process(req, res)
})

router.options('/*', cors(corsOptions))

function process (req, res) {
  res.setHeader('Content-Type', 'application/json')

  const paths = req.url.replace(/^\/|\/$|\?.*$/g, '').split('/')

  let operationId = paths[0]
  let api = esi.apis[operationId]
  if (!operationId || !api) {
    return error_response(res, 404, 'Not Found')
  }

  // extract parameters
  let arguments = extract_parameters(req, res, api)
  if (!arguments) {
    return // assume response was handled inside extract_parameters
  }

  // get data from cache
  cache.get(api, arguments, (data, client) => {
    if (data) {
      res.status(200).send(data)
      return
    }
    // get data from esi

    esi.execute(operationId, arguments, (op, api, params, data, response) => {
      cache.update(op, api, params, data, client, response)

      // TODO: error response
      if (data) {
        res.status(200).send(data)
      } else {
        res.status(204).send()
      }
    })

  })
}

function extract_parameters(req, res, api) {
  let params = {}
  switch (api.method) {
    case 'get': {
      api.parameters.forEach(param => {
        if (param.$ref) {
          const pname = param.$ref.replace(/#\/parameters\//ig, '')
          param = esi.spec.parameters[pname]
        }
        if (!param || !param.name) {
          throw `extract parameters`
        }
        const value = req.query[param.name]
        if (value) {
          params[param.name] = value
        } else if (param.required) {
          return error_response(res, 400, `required ${param.name}`)
        }
      })
      break;
    }
    default:
      throw `Unsupported method ${api.method}`
  }
  return params
}

function error_response (res, status, message) {
  res.status(status || 500)
  res.send({
    message: message,
    status: status || 500,
    timestamp: new Date()
  })
}
module.exports = router;


