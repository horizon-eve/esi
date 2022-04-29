const esi = require('./esi')
const cache = require('./cache')

cache.connection_pool.connect((err, client, release) => {
    if (err) {
        return console.error('Error acquiring listener client', err.stack)
    }
    client.query('LISTEN auth')

    client.on('notification', msg => {
        console.log(msg.payload)
        let event = JSON.parse(msg.payload)
        if (event.event === 'character_info') {
            //character_token(event) REmove later
        }
    })
})

function character_token(event) {
    esi.execute('get_characters_character_id', {character_id: event.char_info.CharacterID}, function(op, api, params, character) {
        cache.update(op, api, params, character)
        esi.execute('get_corporations_corporation_id', {corporation_id: character.corporation_id}, cache.update)
        if (character.alliance_id) {
            esi.execute('get_alliances_alliance_id', {alliance_id: character.alliance_id}, cache.update)
        }
    })
}
