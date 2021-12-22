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

function update(op, api, params, data) {
    var ddl = mapping.operations[op]
    var stmts = []
    // delete old data
    stmt_delete(ddl, params, function (sql, p) {
        stmts.push({sql: sql, params: p})
    })
    stmt_insert(ddl, params, data,function (sql, p) {
        stmts.push({sql: sql, params: p})
    })
    executeTransaction(stmts)
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

function normalize(v) {
    return v === '' ? undefined : v
}

module.exports.executeTransaction = executeTransaction
module.exports.execute = execute
module.exports.update = update
module.exports.connection_pool = pool
