const express = require('express');
const logger = require('morgan');
const indexRouter = require('../routes');

const app = express();
app.use(logger('dev', { stream: console.stdout }))
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use('/', indexRouter);

// error handler
app.use(function(err, req, res, next) {
  // set locals, only providing error in development
  if(!res.headersSent) {
    res.setHeader('Content-Type', 'application/json')
    res.locals.message = err.message || err;
    res.locals.error = req.app.get('env') === 'development' ? err : {};

    // render the error page
    res.status(err.status || 500);
    console.error(err.message || err)
    if (err && err.stack) {
      console.error(err.stack)
    }
    res.json({status: err.status || 500, error: err.message || err})
  }
});

module.exports = app;
