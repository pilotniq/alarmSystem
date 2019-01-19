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

function notify( message, title, priority )
{
    var params = { message: message, titie: title, priority: priority }

    pushover.send( params, function( err, result ) {
		  if( err )
		      log( "Error sending push notification " + title + ": " + err );
		  else
		      log( "Successfully sent notification " + title );
    } )
}

module.exports = { configure, notify }

		   
