var Pool = require('pg').Pool
var cfg = require('./config')

const system_fields = ['user_id']

const pool = new Pool({
    host: cfg.cachedb.host,
    database: cfg.cachedb.database,
    user: cfg.cachedb.user,
    password: cfg.cachedb.password,
    port: cfg.cachedb.port,
    max: cfg.cachedb.max_connections,
    idleTimeoutMillis: cfg.cachedb.idle_timeout,
    connectionTimeoutMillis: cfg.cachedb.connect_timeout
})

function get_client(done, ready) {
    pool.connect((err, client, release) => {
        if (err) {
            return done ? done(err) : console.error(err)
        }
        ready(client, release)
    })
}

var mapping

get_client(null, (client, release) => {
    client.query('select * from swagger_mapping', function(err, result) {
        release()
        if (err) {
            console.error('Error executing query', err.stack)
            process.exit(1);
        }
        else {
            mapping = JSON.parse(result.rows[0].mapping)
            console.log("Cache: Loaded DB mapping for ESI v" + mapping.version)
        }
    })
})

pool.on('connect', function(client) {
    client.query('SET search_path TO ' + cfg.cachedb.schema)
})

function abortOnError (err, client, release, done) {
    if (err) {
        console.error(err)
        client.query('ROLLBACK')
          .catch(err => done(err))
          .finally(release())
    }
    return !!err
}

function executeTransaction(stmts, client, release, done) {
    console.log(stmts)
    client.query('BEGIN', function(err) {
        if (abortOnError(err, client, done)) return
        var stop = false
        stmts.some(function(stmt) {
            client.query(stmt.sql, stmt.params, function(err) {
                if (err) stop = true;
                abortOnError(err, client, done)
            })
            return stop
        })
        if (!stop) {
            client.query('COMMIT')
              .catch(err => done(err))
              .finally(release())
        }
    })
}

function execute(query, params) {
    pool.connect(function(err, client, done) {
        client.query(query, params, function(err) {
            if (err) console.error('Error executing query ' + query + ', params: ' + params, err.stack)
            client.release()
            return done()
        })
    })
}

/**
 * date = "Mon, 17 Jan 2022 18:40:25 GMT"
 content-type = "application/json; charset=UTF-8"
 content-length = "175"
 connection = "close"
 access-control-allow-credentials = "true"
 access-control-allow-headers = "Content-Type,Authorization,If-None-Match,X-User-Agent"
 access-control-allow-methods = "GET,HEAD,OPTIONS"
 access-control-allow-origin = "*"
 access-control-expose-headers = "Content-Type,Warning,ETag,X-Pages,X-ESI-Error-Limit-Remain,X-ESI-Error-Limit-Reset"
 access-control-max-age = "600"
 allow = "GET,HEAD,OPTIONS"
 cache-control = "public"
 etag = ""3f6fa85bb1f2215236622bb41a4feb3ee43dd690759c62ef244c79ea""
 expires = "Tue, 18 Jan 2022 16:54:06 GMT"
 last-modified = "Mon, 17 Jan 2022 16:54:06 GMT"
 strict-transport-security = "max-age=31536000"
 x-esi-error-limit-remain = "100"
 x-esi-error-limit-reset = "35"
 x-esi-request-id = "28a9e8a6-1663-48f5-a2f1-c6c1a9ac70c3"
 * @param op
 * @param api
 * @param params
 * @param data
 * @param client
 * @param response
 */
function update(query, response, data, client, release) {
    const api = query.api
    const params = query.params
    const stmts = []
    const op = api.operationId
    // If response success
    // delete old data
    if (response.statusMessage === 'OK' && data) {
        const ddl = mapping.operations[op]
        stmt_delete(ddl, params, function (sql, p) {
            stmts.push({sql: sql, params: p})
        })
        stmt_insert(ddl, params, data,function (sql, p) {
            stmts.push({sql: sql, params: p})
        })
    }
    // insert into history
    const now = new Date()
    // TODO: think about ciruit breaker. For now, if there an error, it will set 60sec to let esi cool off
    const cached_s = response.statusCode >= 400 ? 60
      : api['x-cached-seconds'] || 0
    const headers = response.headers
    stmts.push({sql: `INSERT INTO ESI.ESI_CALL_HISTORY (RESOURCE_KEY, OPERATION_ID, ETAG, ESI_REQUEST_ID,
                                                        ERROR_LIMIT_REMAINING, ERROR_LIMIT_RESET, STATUS, EXPIRES, LOGGED)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, current_timestamp + ${cached_s} * interval '1 second', current_timestamp)`
        , params: [resource_key(api, params),
            op,
            headers['etag'],
            headers['x-esi-request-id'],
            headers['x-esi-error-limit-remain'],
            headers['x-esi-error-limit-reset'],
            response.statusCode]})

    executeTransaction(stmts, client, release, (err) => {
        if (err) {
            console.error(`cache update failed`, err)
        }
    })
}

function resource_key(api, params) {
    const ordered = Object.keys(params).sort().reduce(
      (obj, key) => {
          obj[key] = params[key];
          return obj;
      },
      {}
    );
    return `${api.operationId}-${JSON.stringify(ordered)}`
}


function get(query, done) {
    get_client(done, (client, release) => {
        if (query.scope) {
            client.query('SELECT * from auth.authenticate_character_in_scope($1, $2, $3, $4)',
              [query.user_token, query.device, parseInt(query.character_id), query.scope])
              .then(res => {
                  query.character_token = res.rows[0].authenticate_character_in_scope
                  if (!query.character_token) {
                      release()
                      return done({status: 401, message: 'was unable to authenticate character'})
                  }
                  const auth_release = () => {
                      client.query('SELECT * from auth.end_authentication()')
                        .catch(error => console.error(error))
                        .finally(release())
                  }
                  doget(client, query, auth_release, done)
              })
              .catch(e => {
                  release()
                  done(e)
              })
        } else {
            doget(client, query, release, done)
        }
    })
}

function doget(client, query, release, done) {
    const api = query.api
    const params = query.params
    const sql_params = [resource_key(api, params)]
    const ddl = `select *
                 from esi.esi_call_history
                 where resource_key = $1 AND expires > current_timestamp
                 order by logged desc
                 limit 1`
    // query call history first to see if it makes sense to get data from cache
    client.query(ddl, sql_params, function (err, res) {
        if (err) {
            release()
            return done(err)
        }
        // Ok there should be some data, move on and query cache, maybe
        if (res.rows && res.rows.length) {
            const log = res.rows[0]
            // there was some problem and it is still active, so stop
            if (log.status >= 400) {
                release()
                return done ({status: 500, message: "esi is down, please try later"})
            }
            const ddl = mapping.operations[api.operationId]
            let stmt

            stmt_select(ddl, params,function (sql, p) {
                stmt = {sql: sql, params: p}
            })

            client.query(stmt.sql, stmt.params, function(err, res) {
                release()
                if (err) {
                    return done(err)
                }
                done(null, res.rows && res.rows.length ? (res.rows.length === 1 ? res.rows[0] : res.rows) : null)
            })
        } else {
            done(null, null, client, release)
        }
    })
}

function stmt_delete(ddl, params, done) {
    var sql = 'DELETE FROM ' + ddl.table
    var p = []
    if (ddl.key) {
        var w = []
        ddl.key.forEach(function(key, idx) {
            w.push(ddl.fields[key] + ' = $' + (idx + 1))
            p.push(params[key])
        })
        sql += ' WHERE ' + w.join(' AND ')
    }
    done(sql, p)
}

function stmt_insert(ddl, params, data, done) {
    let key = ddl.key ? ddl.key : []
    let sql_params = []
    let all_values = []
    let fields = Object.keys(ddl.fields).filter(f => !system_fields.includes(f))
    let columns = fields.map(f => ddl.fields[f])
    let vcounter = 0;
    if (!Array.isArray(data)) data = [data]
    data.forEach(function (row) {
        let values = []
        fields.forEach(field => {
            const val = normalize(
              key.includes(field) // if PK, get from request params, assuming request and response id will be consistent
                ? params[field]
                : ddl.type === 'primitive' // is primitive type, get row as is
                  ? row
                  : row[field] !== undefined // Is there a field matching in response row
                    ? row[field]
                    : params[field] // Last chance - look up in request params
            )
            sql_params.push(val)
            values.push(`$${++vcounter}`)
        })
        // consistency check
        if (values.length !== columns.length) {
            throw new Error(`Inconsisten insert columns:${columns.length}, values: ${values.length}`)
        }
        all_values.push('(' + values.join(',') + ')')
    })
    const sql = 'INSERT INTO ' + ddl.table + ' (' + columns.join(', ') + ') VALUES ' + all_values.join(', ')
    done(sql, sql_params)
}

function stmt_select(ddl, params, done) {
    const columns = Object.values(ddl.fields)

    const filters = []
    const sql_params = []
    Object.keys(params).forEach(field => {
        const col = ddl.fields[field]
        if (col) {
            filters.push(`${col} = $${filters.length +1}`)
            sql_params.push(params[field])
        }
    })
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    const sql = `SELECT ${columns.join(',')} FROM ${cfg.cachedb.schema}.${ddl.table} ${where}`
    done(sql, sql_params)
}

function normalize(v) {
    return v === ''
      ? null
      : Array.isArray(v) // It appears pg client handles arrays incorrectly converting it to an invalid object, use to string before saving in db
        ? JSON.stringify(v)
        : v
}

module.exports.executeTransaction = executeTransaction
module.exports.execute = execute
module.exports.update = update
module.exports.get = get
module.exports.mapping = mapping
module.exports.connection_pool = pool
