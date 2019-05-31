var Pushover = require( 'pushover-notifications' )

const logging = require( './logging' )

var pushover

function log( msg )
{
    logging.log( "Notifications: " + msg );
}

function configure( userKey, appKey )
{
    pushover = new Pushover( { user: userKey, token: appKey } );
}

function notifyEmergency( message, title, expire, retry )
{
    // max expire is 3 hours, 10 800 seconds
    if( expire > 10800 )
	expire = 10800
    
    var params = { message: message, titie: title, priority: 2, expire: expire, retry: retry }

    send( params );
}

function notifyHighPriority( message, title )
{
    var params = { message: message, titie: title, priority: 1 }

    send( params );
}

function notifyNormal( message, title )
{
    var params = { message: message, titie: title, priority: 0 }

    send( params );
}

function send( object )
{
    pushover.send( object, function( err, result ) {
	if( err )
	    log( "Error sending push notification " + object.title + ": " + err );
	else
	    log( "Successfully sent notification " + object.title );
    } );
}

module.exports = { configure, notifyNormal, notifyHighPriority, notifyEmergency }

		   
