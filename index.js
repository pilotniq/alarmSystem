/* index.js - entry point

 1. Start up a web server
*/
const express = require('express')
const onoff = require('onoff')
const fs = require('fs');
var moment = require('moment');
var request = require('request');
var exif = require('fast-exif');

const { exec } = require('child_process');
const {google} = require('googleapis');

const app = express()

// load secrets. OAuth tokens are stored separately
// Will contain fields:
//   pushoverAppKey
//   pushoverUserKey
//   googlePhotosClientID
//   googlePhotosClientSecret
//   googlePhotosAlbumID
//   houseName

const secrets = JSON.parse(fs.readFileSync('secrets.json', 'utf8'));
console.log( "Read secrets" );

const oauth2Client = new google.auth.OAuth2(
    secrets.googlePhotosClientID,
    secrets.googlePhotosClientSecret,
    "http://www.lewin.nu/oauth2callback"
);

const port = 80

// Google Authentication
const scopes = [
    'https://www.googleapis.com/auth/photoslibrary.appendonly',
];

const url = oauth2Client.generateAuthUrl({
    // 'online' (default) or 'offline' (gets refresh_token)
    access_type: 'offline',

    // If you only need one scope you can pass it as a string
    scope: scopes,

    // prompt consent causes refresh token to be sent.
    prompt: 'consent'
});

console.log( "Google Authorization URL: " + url );

// This will provide an object with the access_token and refresh_token.
// Save these somewhere safe so they can be used at a later time.
// oauth2Client.setAccessType( "offline" );
/**
 * This is one of the many ways you can configure googleapis to use authentication credentials.  In this method, 
 * we're setting a global reference for all APIs.  Any other API you use here, like google.drive('v3'), 
 * will now use this auth client. You can also override the auth client at the service and method call levels.
 */

google.options({auth: oauth2Client});

googleTokens = loadTokens()

console.log( "googleTokens loadad: " + JSON.stringify( googleTokens ) );

oauth2Client.on('tokens', (tokens) => {
    console.log( "on tokens callback." );
    if (tokens.refresh_token) {
	googleTokens.refresh_token = tokens.refresh_token;
	// store the refresh_token in my database!
	console.log("refresh token: '" + tokens.refresh_token + "'");
    }
    googleTokens.access_token = tokens.access_token;
    console.log( "access token: '" + tokens.access_token + "'");
    saveTokens( googleTokens );
});

if( googleTokens )
{
    oauth2Client.setCredentials( googleTokens );
    oauth2Client.refreshAccessToken();
    
    console.log( "Set credentials to saved tokens" );
}
else
{
    oauth2Client.getToken( googlePhotosAuthorizationCode ).then( function( r, err ) {
    if( err )
    {
	console.log( "Error getting tokens: " + err );
	return;
    }
    // print tokens fields
    printAttributes( r );

    tokens = r.tokens;

    if( tokens.refresh_token )
	googleTokens = tokens;
    else
	googleTokens.access_token = tokens.access_token;

    saveTokens( googleTokens );
    
    console.log( "tokens=" + tokens );
    printAttributes( tokens.tokens );
    
    console.log( "res=" + r.res );
    printAttributes( r.res );
    
    if( tokens.access_token )
	console.log( "Access token: " + tokens.access_token );
    else
	console.log( "No access token" );
    
    if( tokens.refresh_token) 
	console.log( "Refresh token: " + tokens.refresh_token );

     // create album unless it has been created
    if( !secrets.googlePhotosAlbumID )
      createAlbum( secrets.houseName + " Alarms" );
} ).catch( function( err ) { console.log( "Error getting tokens: " + err ); });
}

setTimeout( refreshTokens, 45 * 60 * 1000 );

app.use(express.static('public'))
// websockets
var expressWs = require('express-ws')(app);
var StatesEnum = { 'disarmed': 'disarmed', 'armed': 'armed', 'preTrigger': 'preTrigger',
		   'triggered': 'triggered' }
var DimmingStatesEnum = { 'fixedBright': 'fixedBright', 'bright': 'bright', 'dimming': 'dimming',
			  'dimmed': 'dimmed', 'brightning' : 'brightning' }
var state = StatesEnum.armed;
var dimmingState = DimmingStatesEnum.bright;

const brightnessFilename = "/sys/class/backlight/rpi_backlight/brightness"
const maxBrightness = 32;
const timeUntilDimmingSeconds = 15; // make this longer later

var screenBrightness = maxBrightness;
var brighteningIntervalMilliseconds = 50;
var brightnessTimer;

var preTriggerTimer, triggeredTimer;
const preTriggerTimeSeconds = 30; // two motion detections in 30 seconds triggers alarm. Only one is forgotten
const maxTriggeredTimeSeconds = 60;
var nextImageTimer;

// camera state
var shutterTime = 0 // 0 = auto
// lower brightnesses will give darker pictures but shorter exposure times
var minCameraBrightness = 0.5
var maxCameraBrightness = 1.0

app.ws( '/websocket', function( ws, req ) {
    ws.on( 'message', function( msg ) {
	switch( msg )
	{
	    case "arm":
	      setState( StatesEnum.armed );
	      break;
	    
	    case "disarm":
	      setState( StatesEnum.disarmed );
	      break;

	    case "trigger":
	      setState( StatesEnum.triggered );
	      break;
	    
	    default:
	      console.log( "Got unknown message: " + msg + ", ignoring");
	}
    })
    sendStateToClient( ws, state );
    cotnsole.log('websocket got connection');
} );
app.get('/rearm', (req, res) => {
    setState( StatesEnum.armed );
    res.send('Armed.');
})
app.listen(port, () => console.log(`Example app listening on port ${port}!`))

var motionPin = new onoff.Gpio(17, 'in', 'both')

setDimmingState( DimmingStatesEnum.bright );
    
motionPin.watch( function(err, value) {
    if( err )
    {
	console.error( "Error in motionPin", err )
	return
    }

    console.log( "Motion: got value " + value );
    if( value == 1 )
    {
	switch( dimmingState )
	{
	    case DimmingStatesEnum.bright:
	      // reset dimming timer
	      clearTimeout( brightnessTimer );
	      brightnessTimer = setTimeout( dimScreen, timeUntilDimmingSeconds * 1000 )
	      console.log( "Screen: Resetting timer to dim screen" );
	      break;
	    
	    case DimmingStatesEnum.brightening:
	      break; // do nothing

	    case DimmingStatesEnum.dimming:
	      clearTimeout( brightnessTimer );
	      brightnessTimer = setTimeout( brightenScreen, brighteningIntervalMilliseconds );
	      dimmingState = DimmingStatesEnum.brightening;
	      console.log( "Screen: Change from dimming to brightening" );
	      break;

	    case DimmingStatesEnum.dimmed:
	      dimmingState = DimmingStatesEnum.brightening;
	      brightnessTimer = setTimeout( brightenScreen, brighteningIntervalMilliseconds );
	      console.log( "Screen: Start brightening" );
	      break;

	    default:
	      console.log( "Invalid DimmingState: " + dimmingState );
	}
	//check if alarm should be triggered
	console.log( "Motion: state=" + state );
	
	switch( state )
	{
	  case StatesEnum.preTrigger:
	    console.log( "Pretriggered and got motion, trigger alarm" );
	    // cancel pretrigger timer
	    clearTimeout( preTriggerTimer );
	    setState( StatesEnum.triggered );
	    break;
	    
	  case StatesEnum.armed:
	    console.log( "Armed and got motion, go to pretriggered");
	    setState( StatesEnum.preTrigger );
	    break;
	}
    }
} );

function setState( newState )
{
    console.log( "setState( '" + newState + "' ) entry" );

    switch( state )
    {
	case StatesEnum.triggered:
	  // if we're leaving triggered state, restore screen brightness to normal max, set timer
	  // for dimming
	  setDimmingState( DimmingStatesEnum.bright );
	  break;
    }
    
    state = newState;
    wss = expressWs.getWss();
    clients = wss.clients;
    console.log( "wss=" + wss );
    console.log( "clients=" + clients );
    console.log( clients.size + " clients" );

    switch( newState )
    {
	case StatesEnum.armed:
	  // When going from pretriggered to armed, 
	  setDimmingState( DimmingStatesEnum.bright );
	  if( nextImageTimer )
	    clearTimeout( nextImageTimer );
	  break;
	
	case StatesEnum.preTrigger:
	  setDimmingState( DimmingStatesEnum.fixedBright )
	  startImageCapture();
	  preTriggerTimer = setTimeout( deTrigger, preTriggerTimeSeconds * 1000 );
	  break;
	
	case StatesEnum.triggered:
	  // Notify via Pushover
  	  pushoverRequest = { 'token': secrets.pushoverAppKey,
			      'user': secrets.pushoverUserKey,
			      'message': "Larm på " + secrets.homeName + ". Bilder på " + secrets.albumURL,
			      'url': secrets.albumURL,
			      priority: 1,
			      sound: 'siren' };
	  request.post({url:'https://api.pushover.net/1/messages.json', json: pushoverRequest},
		     function optionalCallback(err, httpResponse, body) {
			 if (err) {
			     return console.error('pushover notification failed:', err);
			 }
			 console.log('Notification successful!  Server responded with:', body);
		     });
	
	  // start capturing images. Send to Google?
	  console.log( "Calling startImageCapture" );

	  setDimmingState( DimmingStatesEnum.fixedBright )

	  triggeredTimer = setTimeout( rearm, maxTriggeredTimeSeconds * 1000 );
	  // image capture should already be in progress from pretrigger
	  // startImageCapture();
	  break;
    }

    clients.forEach( function( client ) { 
	console.log( "Sending state to client" );
	sendStateToClient( client, state );
    });
}

// called in preTrigger mode, if no additional motion has been detected within a certain time.
function deTrigger()
{
    setState( StatesEnum.armed );
}

function printAttributes( o )
{
    var propValue;
    for(var propName in o) {
	propValue = o[propName]

	console.log(propName + " = " + propValue);
    }
}

function sendStateToClient( client, state )
{
    msg = '{ "type": "stateChange", "state": "' + state + '" }';
    console.log( "sendStateToClient: " + msg );
    client.send( msg );
}

function startImageCapture()
{
    var now = moment();
    var formatted = now.format( "YYYYMMDDHHmmss" );
    var baseFilename = formatted + ".jpg";
    var filename = "public/images/photos/" + baseFilename
    var cameraCommand;

    console.log( "statImageCapture: entry" );
    
    if( shutterTime == 0 )
	cameraCommand = 'raspistill --nopreview --timeout 1000 -q 20 -o ' + filename;
    else
	cameraCommand = 'raspistill --nopreview --timeout 1 -q 10 --shutter ' + shutterTime + ' -o ' + filename;
    
    exec( cameraCommand, (err, stdout, stderr) => {
	if( err )
	{
	    console.log( "Error taking photo" );
	    return;
	}
	console.log( "Photo taken: " + filename );
	exif.read( filename ).then( function( exifData )
				    { var brightness = exifData.exif.BrightnessValue;
				      console.log( "Photo brightness: " + brightness );
				      if( brightness < minCameraBrightness )
				      {
					  if( brightness == 0 )
					  {
					      console.log( "Brightness is zero" );
					      increaseShutterTime();
					  }
					  else
					  {
					      if( shutterTime == 0 )
						  shutterTime = 179;
					      
					      newTime = shutterTime / brightness;

					      console.log( "Brightness was low, " + brightness + " shutter was " + shutterTime / 1000000 + ", newTime=" + newTime );
					      if( newTime >= 6000000 )
						  shutterTime = 6000000;
					      else
						  shutterTime = newTime;

					      console.log( "new shutterTime: " + shutterTime );
					  }
				      }
				      else if( (brightness > maxCameraBrightness) && (shutterTime != 0 ))
				      {
					      newTime = shutterTime / brightness;	
					      console.log( "Brightness was high, " + brightness +
						       " shutter was " + shutterTime / 1000000 + ", newTime=" + newTime );
					      if( newTime >= 6000000 )
						  shutterTime = 6000000;
					      else
						  shutterTime = newTime;

					      console.log( "new shutterTime: " + shutterTime );
				      }
					  // console.log( "exif: " + exifData );
				    });
	// function( err ) { console.log( "exif read error: " + err ); });

	  uploadPhoto( baseFilename, filename, secrets.googlePhotosAlbumID, function() {
	      // keep taking photos while triggered or in pretrigger mode
	      /*
	    */
	});

	switch( state )
	{
	    case StatesEnum.preTrigger:
	    case StatesEnum.triggered:
	      nextImageTimer = setTimeout( function() { 
		switch( state )
		{
		    case StatesEnum.preTrigger:
		    case StatesEnum.triggered:
		      console.log( "Calling startImageCapture for next photok" );
		      startImageCapture()
		      break;

		    default:
		      nextImageTimer = false;
		}
	      }, 1 ); // 1 millisecond between images 
	    default:
	      nextImageTimer = false;
	}
	/*
	 * Implementation for other host:
	 *
	var formData = {
	    filename: baseFilename,
	    file: fs.createReadStream(filename)
	};

	// fs.create
	
	request.post({url:'<url>', formData: formData},
		     function optionalCallback(err, httpResponse, body) {
			 // If we're still triggered, take another photo
			 if( state == StatesEnum.triggered )
			     startImageCapture()

			 if (err) {
			     return console.error('upload failed:', err);
			 }
			 console.log('Upload successful!  Server responded with:', body);
		     });
	*/
    });
    
}

async function uploadPhoto( baseFilename, filename, albumID, callback )
{
    var url = "https://photoslibrary.googleapis.com/v1/uploads";
    var headers = await oauth2Client.getRequestHeaders();

    headers['Content-Type'] = 'application/octet-stream';
    headers['X-Goog-Upload-File-Name'] = baseFilename;
    headers['X-Goog-Upload-Protocol'] = 'raw';
    
    request.post( {url: url, headers: headers, body: fs.createReadStream(filename) },
		  function( error, response, body )
		  {
		      if( error )
		      {
			  console.log( "Google upload error: " + error );
			  return;
		      }

		      if( response.statusCode != 200 )
		      {
			  console.log( "Google upload error: " + response.statusCode + " " +
				       response.statusMessage );
			  return;
		      }
		      uploadToken = body;
		      console.log( "Photo uploaded. response: '" + response.statusCode + " " +
				   response.statusMessage );

		      // create media item
		      createMediaItem( uploadToken, albumID, "Hall camera picture" );

		      callback();
		  });
}

async function createMediaItem( uploadToken, albumID, description )
{ 
    var url = "https://photoslibrary.googleapis.com/v1/mediaItems:batchCreate";
    var headers = await oauth2Client.getRequestHeaders();
    headers['Content-Type'] = 'appication/json';
    var body = '{ "albumId": "' + albumID + '", "newMediaItems": [ { "description": "' + description +
	'", "simpleMediaItem": { "uploadToken": "' + uploadToken + '" } } ] }';

    console.log( "createMediaItem, headers=" + JSON.stringify( headers ) );

    request.post( {url: url, headers: headers, body: body },
		  function( error, response, body )
		  {
		      if( error )
		      {
			  console.log( "Google batchCreate error: " + error );
			  return;
		      }
		      else if( response.statusCode != 200 )
		      {
			  console.log( "createMediaItem error code: " + response.statusCode + " " +
				       response.statusMessage );
		      }
		      console.log( "Photo created in album." );
		  });
}

function createAlbum( title )
{
    var url = "https://photoslibrary.googleapis.com/v1/albums";
    var headers = {
	'Authorization': 'Bearer ' + googleTokens.access_token,
	'Content-Type': 'application/json',
    };
    var body = '{ "album": { "title": "' + title + '"} }';
    
    request.post( {url: url, headers: headers, body: body },
		  function( error, response, body )
		  {
		      if( error )
		      {
			  console.log( "Google album creation error: " + error );
			  return;
		      }
		      console.log( "Album creation body: " + body );
		      album = JSON.parse( body );
		      googlePhotosAlbumID = album.id;
		      
		      console.log( "Album created. ID=" + album.id );
		  });
}


function increaseShutterTime()
{
    console.log( "increaseShutterTime, was " + shutterTime );	    
     if( shutterTime == 0 )
	 shutterTime = 100000; // 1 / 10 second
    else
    {
	shutterTime = shutterTime * 8;
	if( shutterTime > 6000000 )
	    shutterTime = 6000000;
    }
    console.log( "... is now " + shutterTime );
}
	
function setBrightness( newBrightness )
{
    fs.writeFile( brightnessFilename, newBrightness.toString(), function(err) {
	if(err)
	    return console.log( "Error writing to screen brightness file: " + err);
    }); 
}

function dimScreen()
{
    if( dimmingState != DimmingStatesEnum.dimming )
    {
	dimmingState = DimmingStatesEnum.dimming;
	console.log( "Staring screen dimming" );
    }

    if( screenBrightness > 0 )
    {
	screenBrightness--;
	setBrightness( screenBrightness );
    }
    
    if( screenBrightness == 0 )
    {
	dimmingState = DimmingStatesEnum.dimmed;
	console.log( "Screen: dimming completed" );
    }
    else
	brightnessTimer = setTimeout( dimScreen, brighteningIntervalMilliseconds );
}

function brightenScreen()
{
    if( dimmingState != DimmingStatesEnum.brightening )
	dimmingState = DimmingStatesEnum.brightening;

    screenBrightness++;
    setBrightness( screenBrightness );
    
    if( screenBrightness >= maxBrightness )
    {
	dimmingState = DimmingStatesEnum.bright;
	console.log( "Screen: brightening completed" );
    }
    else
	brightnessTimer = setTimeout( brightenScreen, brighteningIntervalMilliseconds );
}

function setDimmingState( newState )
{
    if( newState == state )
	return;

    dimmingState = newState;
    
    switch( newState )
    {
	case DimmingStatesEnum.fixedBright:
	  setBrightness( 255 ); // max brightness
	  dimmingState = 'bright';
	  if( !(brightnessTimer === undefined) )
	      clearTimeout( brightnessTimer );
	  break;

	case DimmingStatesEnum.bright:
	  setBrightness( maxBrightness );
	  if( !(brightnessTimer === undefined) )
	      clearTimeout( brightnessTimer );
	
	  brightnessTimer = setTimeout( dimScreen, timeUntilDimmingSeconds * 1000);
	  break;
    }
}

function loadTokens()
{
    return JSON.parse( fs.readFileSync( "tokens.json" ) );
}

function saveTokens( tokens )
{
    fs.writeFileSync( "tokens.json", JSON.stringify( tokens ) );
}

function rearm()
{
    setState( StatesEnum.armed );
}

// refresh tokens every 25 minutes
function refreshTokens()
{
    oauth2Client.refreshAccessToken();
    setTimeout( refreshTokens, 25 * 60 * 1000 );
}
