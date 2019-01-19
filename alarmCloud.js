const crypto = require('crypto')
const fetch = require('node-fetch')

const logging = require( './logging' )
const notifications = require( './notifications' )

const pingIntervalSeconds = 5 * 60 // ping
const repingIntervalSeconds = 60 // reping once a minute

var url, key, pingTImer, repingCount = 0, cloudDown = false

function configure( cloudUrl, cloudKey )
{
    url = cloudUrl
    key = cloudKey

    repingCount = 0
    doPing(); // will set timers to repeatedly ping
    // pingTimer = setTimeout( doPing, pingIntervalSeconds * 1000 );
}

function doPing()
{
    fetch( url,
	   {
	       method: "GET",
	       mode: "cors",
	       headers: {
		   "Content-Type": "application/json",
	       },
	       // body: JSON.stringify( { "event": "ping" } )
	   })
	.then( function( response ) {
	    if( response.ok )
	    {
		log( "ping OK" )
		repingCount = 0
		if( cloudDown )
		{
		    notifications.notify( "Cloud alarm server back up", "Cloud alarm server back up", 0 )
		    cloudDown = false
		}
		pingTimer = setTimeout( doPing, pingIntervalSeconds * 1000 )
	    }
	    else
		pingFail( "Error sending ping to alarm cloud server: " + response.status + " " + response.statusText )
	} )
	.catch( function( error ) {
	    pingFail( "Network error: " + error )
	} )
	    }

function pingFail( msg )
{
    repingCount++
    // try again once a minute for 10 minutes. If not successful, send pushover notification
    if( repingCount == 10 )
    {
	cloudDown = true
	notifications.notify( "Cloud alarm server can't be reached from house alarm. Error: " + msg,
			      "Cloud alarm server down", 0 )
    }
		
    log( "Failed to ping to cloud, try " + repingCount + ": " + msg )
    
    pingTimer = setTimeout( doPing, repingIntervalSeconds * 1000 );
}

function waitForDisarm()
{
    sendMessage( "waitForDisarm" );
}

function disarmed()
{
    sendMessage( "disarmed" );
}

function triggered()
{
    sendMessage( "triggered" );
}

function log( message )
{
    logging.log( "alarmCloud: " + message )
}

function sendMessage( msg )
{
    const timestamp = Math.floor( Date.now() / 1000 )
    const hash = crypto.createHmac( 'sha256', key )
	  .update( timestamp.toString() )
	  .digest( 'hex' );
    
    fetch( url,
	   {
	       method: "POST",
	       mode: "cors",
	       headers: {
		   "Content-Type": "application/json",
		   "X-timestamp": timestamp,
		   "X-hash": hash
	       },
	       body: JSON.stringify( { "event": msg } )
	   })
	.then( function( response ) {
	    if( !response.ok )
		log( "Failed to send message to cloud: " + response.status + " " + response.statusText )
	} )
	.catch( function( error ) {
	    log( "Network error sending message to cloud: " + error);
	} )
	    }

module.exports = { configure, waitForDisarm, disarmed }
