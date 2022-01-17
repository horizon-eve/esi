var Pool = require('pg').Pool
var cfg = require('./config')

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

var mapping

pool.connect(function(err, client, release) {
    if (err) {
        return console.error('Error acquiring client', err.stack)
    }
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

function abortOnError (err, client, done) {
    if (err) {
        console.error('Error in transaction', err.stack)
        client.query('ROLLBACK', function(err) {
            if (err) {
                console.error('Error rolling back client', err.stack)
            }
            // release the client back to the pool
            // done()
        })
    }
    return !!err
}

function executeTransaction(stmts) {
    console.log(stmts)
    pool.connect(function(err, client, done) {
        client.query('BEGIN', function(err) {
            if (abortOnError(err, client, done)) return
            var stop = false
            stmts.some(function(stmt) {
                client.query(stmt.sql, stmt.params, function(err, res) {
                    if (err) stop = true;
                    abortOnError(err, client, done)
                })
                return stop
            })
            if (!stop) {
                client.query('COMMIT', function(err) {
                    if (err) console.error('Error committing transaction', err.stack)
                    done()
                })
            }
        })
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
function update(op, api, params, data, client, res) {
    var ddl = mapping.operations[op]
    var stmts = []
    // delete old data
    stmt_delete(ddl, params, function (sql, p) {
        stmts.push({sql: sql, params: p})
    })
    stmt_insert(ddl, params, data,function (sql, p) {
        stmts.push({sql: sql, params: p})
    })
    // insert into history
    const now = new Date()
    const cached_ms = api['x-cached-seconds'] ? api['x-cached-seconds'] * 1000 : 0
    const headers = res.headers
    const expires = new Date(now.getTime() + cached_ms)
    stmts.push({sql: `INSERT INTO ESI.ESI_CALL_HISTORY (RESOURCE_KEY, OPERATION_ID, ETAG, ESI_REQUEST_ID,
                                                        ERROR_LIMIT_REMAINING, ERROR_LIMIT_RESET, STATUS, EXPIRES, LOGGED)
                      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`
        , params: [resource_key(api, params),
            op,
            headers['etag'],
            headers['x-esi-request-id'],
            headers['x-esi-error-limit-remain'],
            headers['x-esi-error-limit-reset'],
            res.statusCode,
            expires,
            now] })

    executeTransaction(stmts, client)
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


function get(api, params, done) {
    const sql_params = [resource_key(api, params)]
    const ddl = `select *
                 from esi.esi_call_history
                 where resource_key = $1 AND expires > current_timestamp
                 order by logged desc
                 limit 1`

    pool.connect(function (err, client, release) {
        if (err) {
            release()
            return console.error('Error acquiring client', err)
        }
        client.query(ddl, sql_params, function (err, res) {
            if (err) {
                release()
                return console.error('could not query cache', err)
            }
            if (res.rows && res.rows.length) {
                const ddl = mapping.operations[api.operationId]
                let stmt

                stmt_select(ddl, params,function (sql, p) {
                     stmt = {sql: sql, params: p}
                })

                client.query(stmt.sql, stmt.params, function(err, res) {
                    release()
                    if (err) {
                        return console.error('could not query cache', err)
                    }
                    done(res.rows)
                })
            } else {
                done(null, client)
            }
        })
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
    var columns = Object.values(ddl.fields)
    var fields = Object.keys(ddl.fields)
    var key = ddl.key ? ddl.key : []
    var sql_params = []
    var all_values = []
    var vcounter = 0;
    if (!Array.isArray(data)) data = [data]
    data.forEach(function (row) {
        var values = []
        fields.forEach(function(field) {
            sql_params.push(normalize(key.includes(field) ? params[field] : ddl.type === 'primitive' ? row : row[field]))
            values.push(`$${++vcounter}`)
        })
        all_values.push('(' + values.join(',') + ')')
    })
    var sql = 'INSERT INTO ' + ddl.table + ' (' + columns.join(', ') + ') VALUES ' + all_values.join(', ')
    done(sql, sql_params)
}

function stmt_select(ddl, params, done) {
    const columns = Object.values(ddl.fields)

    const filters = []
    const sql_params = []
    Object.keys(params).forEach(field => {
        filters.push(`${ddl.fields[field]} = $${filters.length +1}`)
        sql_params.push(params[field])
    })
    const where = filters.length ? `WHERE ${filters.join(' AND ')}` : ''
    const sql = `SELECT ${columns.join(',')} FROM ${cfg.cachedb.schema}.${ddl.table} ${where}`
    done(sql, sql_params)
}

function normalize(v) {
    return v === '' ? undefined : v
}

module.exports.executeTransaction = executeTransaction
module.exports.execute = execute
module.exports.update = update
module.exports.get = get
module.exports.mapping = mapping
module.exports.connection_pool = pool
