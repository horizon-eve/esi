var express = require('express');
var router = express.Router();
const esi = require('../bin/esi'),
  cache = require('../bin/cache')


/* GET users listing. */
router.get('/', function(req, res, next) {
  //esi.execute('get_characters_character_id', {character_id: '360888111'}, cache.update)
  esi.execute('get_alliances', null, cache.update)

  res.send('respond with a resource');
});

module.exports = router;
