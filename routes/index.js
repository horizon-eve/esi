const express = require('express')
const config = require('../src/config')
const cors = require('cors')
const useragent = require('useragent')
const esi = require('../src/esi')

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

router.options('/*', cors(corsOptions),function(req, res) {
  res.end()
})

function process (req, res) {
  res.setHeader('Content-Type', 'application/json')

  const paths = req.url.replace(/^\/|\/$|\?.*$/g, '').split('/')
  let operationId = paths[0]
  let api = esi.apis[operationId]
  if (!operationId || !api) {
    return error_response(res, {status: 404, message: 'Not Found'})
  }

  // start preparing query
  let query = {api: api}

  // This api requres authorization, extract required scope and auth token
  if (api.security && api.security.length) {
    // assume there will be always 1 scope needed per api (hopefully)
    query.scope = api.security[0].evesso[0]
    if (!query.scope) {
      return error_response(res, {status: 500, message: 'scope extraction needs some love'})
    }

    query.device = get_device(req.headers['user-agent'])
    if (!query.device)
      return error_response(res, {status: 401, message: 'Could not authenticate request'})

    query.character_id = req.headers[config.api.char_header] || req.query.character_id
    if (!query.character_id)
      return error_response(res, {status: 401, message: 'This call requires character_id'})

    query.user_token = req.headers[config.api.auth_header] || req.query.auth_token
    if (!query.user_token)
      return error_response(res, {status: 401, message: 'This api requires authorization'})
  }

  // extract parameters
  query.params = extract_parameters(req, res, api)
  if (!query.params) {
    return // assume response was handled inside extract_parameters
  }

  // TBD: validate inputs

  esi.execute(query, (errors, data) => {
    res.setHeader('Content-Type', 'application/json');
    if (errors) {
      if (errors instanceof Error) {
        console.error("TODO: generate erorr id", errors)
      }
      return error_response(res, errors)
    } else if (data) {
      res.status(200).send(data)
    } else {
      res.status(204).send()
    }
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
          return error_response(res, 400,'extract parameters')
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
      return error_response(res, 400, `Unsupported method ${api.method}`)
  }
  return params
}


function error_response(res, errors) {
  res.status(errors.status ? errors.status : 500).send({
    message: errors.message ? errors.message : errors,
    status: errors.status ? errors.status : 500,
    timestamp: new Date()
  })
}

function get_device(user_agent) {
  let ua =  useragent.parse(user_agent);
  return `${ua.family}-${ua.os.family}${ua.os.major}-${ua.device.family}`.toLowerCase()
}

module.exports = router;


