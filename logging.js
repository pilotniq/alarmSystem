/*
 * logging.js
 * Logging for homePanel / Alarm system
 */

function log( str )
{
    console.log( new Date().toLocaleString() + " " + str );
}

module.exports = { log }
