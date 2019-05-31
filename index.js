/* index.js - entry point

 1. Start up a web server
*/
const express = require('express')
const onoff = require('onoff')
const fs = require('fs');
var moment = require('moment');
var request = require('request');
var semaphore = require('semaphore')
const { exec } = require('child_process');
const {google} = require('googleapis');
const app = express()
const mqtt = require('mqtt');

const logging = require( './logging' )
const ups = require ('./ups')
const lights = require( './lights' )
const camera = require( './camera' )
const alarmCloud = require( './alarmCloud' )
const notifications = require( './notifications' )

// load secrets. OAuth tokens are stored separately
// Will contain fields:
//   pushoverAppKey
//   pushoverUserKey
//   googlePhotosClientID
//   googlePhotosClientSecret
//   googlePhotosAlbumID
//   houseName

const secrets = JSON.parse(fs.readFileSync('secrets.json', 'utf8'));
log( "Read secrets" );

alarmCloud.configure( secrets.cloudURL, secrets.cloudKey )

lights.setKey( secrets.deconzKey, secrets.deconzHostname )

const oauth2Client = new google.auth.OAuth2(
    secrets.googlePhotosClientID,
    secrets.googlePhotosClientSecret,
    "http://www.lewin.nu/oauth2callback"
);

// I can't get systemd startup to allow this program to open port 80.
const port = 8080

// Initialize Pushover
notifications.configure( secrets.pushoverUserKey, secrets.pushoverAppKey );

// var pushover = new Pushover( { 

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

log( "Google Authorization URL: " + url );

// This will provide an object with the access_token and refresh_token.
// Save these somewhere safe so they can be used at a later time.
// oauth2Client.setAccessType( "offline" );
/**
 * This is one of the many ways you can configure googleapis to use authentication credentials.  In this method, 
 * we're setting a global reference for all APIs.  Any other API you use here, like google.drive('v3'), 
 * will now use this auth client. You can also override the auth client at the service and method call levels.
 */

google.options({auth: oauth2Client});

try
{
    googleTokens = loadTokens()
    log( "googleTokens loadad: " + JSON.stringify( googleTokens ) );
}
catch( err )
{
    log( "Failed to load Google tokens: " + err );
    
    // const { googleTokens } = await oauth2Client.getToken(code).then( oauth2Client.setCredentials(tokens) );
    // oauth2Client.setCredentials(tokens);
}

oauth2Client.on('tokens', (tokens) => {
    log( "on tokens callback." );
    if (tokens.refresh_token) {
	googleTokens.refresh_token = tokens.refresh_token;
	// store the refresh_token in my database!
	log("refresh token: '" + tokens.refresh_token + "'");
    }
    googleTokens.access_token = tokens.access_token;
    log( "access token: '" + tokens.access_token + "'");
    saveTokens( googleTokens );
});

if( Object.keys(googleTokens).length > 0 )
{
    oauth2Client.setCredentials( googleTokens );
    oauth2Client.refreshAccessToken();
    
    log( "Set credentials to saved tokens" );
}
else
{
    // use the auth.js program to get new codes, store them directly in tokens.json
    googlePhotosAuthorizationCode = "XYZ";
    oauth2Client.getToken( googlePhotosAuthorizationCode ).then( function( r, err ) {
    if( err )
    {
	log( "Error getting tokens: " + err );
	log( JSON.stringify( err ) );
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
    
    log( "tokens=" + tokens );
    printAttributes( tokens.tokens );
    
    log( "res=" + r.res );
    printAttributes( r.res );
    
    if( tokens.access_token )
	log( "Access token: " + tokens.access_token );
    else
	log( "No access token" );
    
    if( tokens.refresh_token) 
	log( "Refresh token: " + tokens.refresh_token );

     // create album unless it has been created
    if( !secrets.googlePhotosAlbumID )
      createAlbum( secrets.houseName + " Alarms" );
} ).catch( function( err ) { log( "Error getting tokens: " + err ); });
}

setTimeout( refreshTokens, 45 * 60 * 1000 );

app.use(express.static('public'))
// websockets
var expressWs = require('express-ws')(app);
var StatesEnum = { 'disarmed': 'disarmed',
		   'waitForArm': 'waitForArm',
		   'armed': 'armed',
		   'preTrigger': 'preTrigger',
		   'waitForDisarm': 'waitForDisarm',
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

var waitForArmTimer, preTriggerTimer, waitForDisarmTimer, triggeredTimer;
const preTriggerTimeSeconds = 30; // two motion detections in 30 seconds triggers alarm. Only one is forgotten
const maxTriggeredTimeSeconds = 60;
const waitForDisarmMaxTimeSeconds = 60;
const waitForArmTimeSeconds = 60;

var nextImageTimer;
var webSocket;

const photoDifferenceUploadThreshold = 0.995
// contains filename of previous photo taken
// will be compared against new photo. If difference is large enough, upload.
var prevPhotoFilename
var compareSemaphore = semaphore(1); // at most one compare process. Want to compare against latest uploaded.

ups.startBatteryMonitoring( upsCallback )

app.ws( '/websocket', function( ws, req ) {
    webSocket = ws;
    ws.on( 'message', function( msgText ) {
	var msg = JSON.parse( msgText );
	switch( msg.command )
	{
	    case "arm":
	      setState( StatesEnum.waitForArm );
	      break;
	    
	    case "disarm":
	      if( state == StatesEnum.waitForArm || msg.pin == secrets.pin )
	          setState( StatesEnum.disarmed );
	      else
	        console.log( "Got pin '" + msg.pin + "', expecting '" + secrets.pin + "'");
	      break;

	    case "trigger":
	      setState( StatesEnum.triggered );
	      break;
	    
	    default:
	      log( "Got unknown message: " + msg + ", ignoring");
	}
    })
    sendStateToClient( ws, state );
    console.log('websocket got connection');
} );

log( "Connecting to MQTT..." );
var mqttClient = mqtt.connect( 'mqtt://hallen.local' );
mqttClient.on( 'connect', mqttConnected );
mqttClient.on( 'message', mqttMessage );

function mqttConnected()
{
    log( "Connected to MQTT" );
    mqttClient.subscribe( 'power', mqttSubscribed );
    mqttClient.subscribe( 'rooms/outdoors/temperature', mqttSubscribed );
}

function mqttSubscribed( err )
{
    if( err )
	log( "error subscribing to mqtt: " + err.toString() );
}

function mqttMessage( topic, message )
{
    log( "mqttMessage: topic='" + topic + "', message='" + message + "'" );

    if( topic == "power" )
	mqttGotPower( message )
    else if( topic == "rooms/outdoors/temperature" )
	mqttGotTemperature( message )
}
function mqttGotPower( message )
{
    // log( "Got power " + message );
    msg = '{ "type": "power", "power": "' + message + '" }';
    wsBroadcast( msg );
/*
    if( webSocket )
	webSocket.send( msg );
    else
	log( "got power, but no websocket" );
*/
}

function mqttGotTemperature( message )
{
    log( "mqttGotTemperature: message='" + message + "'" );

    msg = '{ "type": "temperature", "temperature": "' + parseFloat( message ).toFixed(1) + '" }';
    wsBroadcast( msg );
}
    
app.get('/rearm', (req, res) => {
    setState( StatesEnum.armed );
    res.send('Armed.');
})
app.get('/location', (req, res) => {
    var location = { "longitude": secrets.longitude, "latitude": secrets.latitude, "altitude": secrets.altitude }
    res.send( location );
})


app.listen(port, () => log(`Example app listening on port ${port}!`))

var motionPin = new onoff.Gpio(17, 'in', 'both')

setDimmingState( DimmingStatesEnum.bright );
    
motionPin.watch( function(err, value) {
    if( err )
    {
	console.error( "Error in motionPin", err )
	return
    }

    log( "Motion: got value " + value );
    if( value == 1 )
    {
	lights.motion()
	
	switch( dimmingState )
	{
	    case DimmingStatesEnum.bright:
	      // reset dimming timer
	      clearTimeout( brightnessTimer );
	      brightnessTimer = setTimeout( dimScreen, timeUntilDimmingSeconds * 1000 )
	      log( "Screen: Resetting timer to dim screen" );
	      break;
	    
	    case DimmingStatesEnum.brightening:
	      break; // do nothing

	    case DimmingStatesEnum.dimming:
	      clearTimeout( brightnessTimer );
	      brightnessTimer = setTimeout( brightenScreen, brighteningIntervalMilliseconds );
	      dimmingState = DimmingStatesEnum.brightening;
	      log( "Screen: Change from dimming to brightening" );
	      break;

	    case DimmingStatesEnum.dimmed:
	      dimmingState = DimmingStatesEnum.brightening;
	      brightnessTimer = setTimeout( brightenScreen, brighteningIntervalMilliseconds );
	      log( "Screen: Start brightening" );
	      break;

	    default:
	      log( "Invalid DimmingState: " + dimmingState );
	}
	//check if alarm should be triggered
	log( "Motion: state=" + state );
	
	switch( state )
	{
	  case StatesEnum.preTrigger:
	    log( "Pretriggered and got motion, go into waitForDisarm mode" );
	    // cancel pretrigger timer
	    clearTimeout( preTriggerTimer );
	    setState( StatesEnum.waitForDisarm );
	    break;
	    
	  case StatesEnum.armed:
	    log( "Armed and got motion, go to pretriggered");
	    setState( StatesEnum.preTrigger );
	    break;
	}
    }
} );

function setState( newState )
{
    log( "setState( '" + newState + "' ) entry" );

    switch( state )
    {
	case StatesEnum.waitForArm:
	  clearTimeout( waitForArmTimer );
	  break;
	
	case StatesEnum.preTrigger:
	  clearTimeout( preTriggerTimer );
	  break;
	
	case StatesEnum.waitForDisarm:
	  clearTimeout( waitForDisarmTimer );
	  break;
	
	case StatesEnum.triggered:
	  // if we're leaving triggered state, restore screen brightness to normal max, set timer
	  // for dimming.
	  setDimmingState( DimmingStatesEnum.bright );
	  clearTimeout( triggeredTimer );
	break;

    }
    
    state = newState;

    switch( newState )
    {
	case StatesEnum.disarmed:
	  alarmCloud.disarmed()
	  lights.setBrightness( lights.defaultBrightness );
	  lights.setMotionTrigger( true )
	  break;
	
	case StatesEnum.waitForArm:
	  lights.setBrightness( lights.defaultBrightness )
	  lights.setMotionTrigger( true )
	  setDimmingState( DimmingStatesEnum.bright );
	  waitForArmTimer = setTimeout( arm, waitForArmTimeSeconds * 1000 );
	  break;
	
	case StatesEnum.armed:
	  // When going from pretriggered to armed, 
	  lights.setBrightness( lights.maxBrightness )
	  lights.setMotionTrigger( true )
	  setDimmingState( DimmingStatesEnum.bright );
	  if( nextImageTimer )
	    clearTimeout( nextImageTimer );
	  break;
	
	case StatesEnum.preTrigger:
	  setDimmingState( DimmingStatesEnum.fixedBright )
	  lights.setMotionTrigger( false )
	  lights.setState( true )
	  lights.setBrightness( lights.maxBrightness )
	  startImageCapture();
	  preTriggerTimer = setTimeout( deTrigger, preTriggerTimeSeconds * 1000 );
	  break;

	case StatesEnum.waitForDisarm:
	  setDimmingState( DimmingStatesEnum.fixedBright )
	  lights.setBrightness( lights.maxBrightness )
	  lights.setMotionTrigger( false )
	  lights.setState( true )
	  waitForDisarmTimer = setTimeout( trigger, waitForDisarmMaxTimeSeconds * 1000 );
	
	  // send a message to stratus that we are in waitForDisarm mode.
	  // then send a message again when we are disarmed.
	  // if stratus doesn't get the second message, it sends alarm notification
	  alarmCloud.waitForDisarm( "waitForDisarm" )
	  break;
	
	case StatesEnum.triggered:
	  // Notify via Pushover
	  /*
	var msg = { message = 
		    priority: 2,
		    expire: 10800, retry: 3 * 60 }
	  */
	notifications.notifyEmergency( "Larm på " + secrets.houseName + ". Bilder på " + secrets.albumURL,
				       "Inbrottslarm på " + secrets.houseName, 10800, 120 );
	/*
  	  pushoverRequest = { 'token': secrets.pushoverAppKey,
			      'user': secrets.pushoverUserKey,
			      'message': "Larm på " + secrets.houseName + ". Bilder på " + secrets.albumURL,
			      'url': secrets.albumURL,
			      priority: 1,
			      sound: 'siren' };
	  request.post({url:'https://api.pushover.net/1/messages.json', json: pushoverRequest},
		     function optionalCallback(err, httpResponse, body) {
			 if (err) {
			     return console.error('pushover notification failed:', err);
			 }
			 log('Notification successful!  Server responded with:', body);
		     });
*/
	  lights.setBrightness( lights.maxBrightness )
	  lights.setMotionTrigger( false )
	  lights.setState( true )
	  alarmCloud.triggered()
	
	  // start capturing images. Send to Google?
	  log( "Calling startImageCapture" );

	  setDimmingState( DimmingStatesEnum.fixedBright )

	  triggeredTimer = setTimeout( arm, maxTriggeredTimeSeconds * 1000 );
	  // image capture should already be in progress from pretrigger
	  // startImageCapture();
	  break;
    }

    var msg = '{ "type": "stateChange", "state": "' + state + '" }';
    wsBroadcast( msg );
    /*
    clients.forEach( function( client ) { 
 	log( "Sending state to client" );
	sendStateToClient( client, state );
    });
    wss = expressWs.getWss();
    clients = wss.clients;
    log( "wss=" + wss );
    log( "clients=" + clients );
    log( clients.size + " clients" );
*/
}

function wsBroadcast( message )
{
    wss = expressWs.getWss();
    clients = wss.clients;
    // log( clients.size + " clients" );

    clients.forEach( function( client ) { 
	// log( "broadcast to clients: " + message );
	client.send( message );
    });
}

// called in preTrigger mode, if no additional motion has been detected within a certain time.
function deTrigger()
{
    setState( StatesEnum.armed );
}

function trigger()
{
    setState( StatesEnum.triggered );
}

function printAttributes( o )
{
    var propValue;
    for(var propName in o) {
	propValue = o[propName]

	log(propName + " = " + propValue);
    }
}

function sendStateToClient( client, state )
{
    msg = '{ "type": "stateChange", "state": "' + state + '" }';
    log( "sendStateToClient: " + msg );
    client.send( msg );
}

async function startImageCapture()
{
    var now = moment();
    var formatted = now.format( "YYYYMMDDHHmmss" );
    var baseFilename = formatted + ".jpg";
    var filename = "public/images/photos/" + baseFilename
    var cameraCommand;

    log( "statImageCapture: entry." );

    await camera.takePicture( filename );

    log( "after takePicture, file exists: " + fs.existsSync( filename ) );
    
    if( prevPhotoFilename )
    {
	// We get out of memory with too many compare processes. Must limit them.
	compareSemaphore.take( function () {
	    compareAndUpload( filename, baseFilename );
	    compareSemaphore.leave();
	} );
    }
    else
    {
	log( "Uploading first Photo" );
	prevPhotoFilename = filename;
	uploadPhoto( baseFilename, filename, secrets.googlePhotosAlbumID, function() {});
    }
    
    // keep taking photos while triggered or in pretrigger mode
    switch( state )
    {
	case StatesEnum.preTrigger:
	case StatesEnum.triggered:
	case StatesEnum.waitForDisarm:
	  var delay = 1000000 - camera.getShutterTime_us()
	
	  log( "Next photo delay = " + delay + " us" );
	  if( delay <= 1000 )
	  {
	      startImageCapture()
	      // nextImageTimer = false;
	  }
	  else
	      nextImageTimer = setTimeout( function() {
		  log( "nextImageTimer function called" );
		switch( state )
		{
		    case StatesEnum.preTrigger:
		    case StatesEnum.triggered:
		    case StatesEnum.waitForDisarm:
		      log( "Calling startImageCapture for next photok" );
		      startImageCapture()
		      break;

		    default:
		      nextImageTimer = false;
		}
	       }, delay / 1000 ); // try to keep 1s between photos.
	       break;
	    
	default:
	  log( "Not setting nextImageTimer, because state is " + state );
	  nextImageTimer = false;
    } // end of switch
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
			 log('Upload successful!  Server responded with:', body);
		     });
	*/
}

// compare if the photo with the given filename is sufficiently different from the previously uploaded
// photo. If so upload it, otherwise ignore
// TODO: Should autolevel images before comparison
function compareAndUpload( filename, baseFilename )
{
    var compareCommand = "compare -metric NCC " + prevPhotoFilename + " " + filename + " null:";

    exec( compareCommand, (err, stdout, stderr) => {
	var difference;
	
	/* err 1 or 2 just indicates if the images are deemed different or not, but we use the score
	   if( err )
	   {
	   log( "Error comparing photos: " + err );
	   log( "stderr: " + stderr );
	   log( "stdout: " + stdout );
	   log( "command: " + compareCommand );
	   return;
	   }
	*/
	difference = parseFloat( stderr );
	log( "Image difference: " + difference );

	if( difference < photoDifferenceUploadThreshold )
	{
	    log( "Photo is differet, uploading" );
	    uploadPhoto( baseFilename, filename, secrets.googlePhotosAlbumID, function() {
		prevPhotoFilename = filename});
	}
	else
	    log( "Photos too similar, not uploading" );
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
			  log( "Google upload error: " + error );
			  return;
		      }

		      if( response.statusCode != 200 )
		      {
			  log( "Google upload error: " + response.statusCode + " " +
				       response.statusMessage );
			  return;
		      }
		      uploadToken = body;
		      log( "Photo uploaded. response: '" + response.statusCode + " " +
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

    log( "createMediaItem, headers=" + JSON.stringify( headers ) );

    request.post( {url: url, headers: headers, body: body },
		  function( error, response, body )
		  {
		      if( error )
		      {
			  log( "Google batchCreate error: " + error );
			  return;
		      }
		      else if( response.statusCode != 200 )
		      {
			  log( "createMediaItem error code: " + response.statusCode + " " +
				       response.statusMessage );
		      }
		      else
			  log( "Photo created in album." );
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
			  log( "Google album creation error: " + error );
			  return;
		      }
		      log( "Album creation body: " + body );
		      album = JSON.parse( body );
		      googlePhotosAlbumID = album.id;
		      
		      log( "Album created. ID=" + album.id );
		  });
}

/*
function increaseShutterTime()
{
    log( "increaseShutterTime, was " + shutterTime );	    
     if( shutterTime == 0 )
	 shutterTime = 100000; // 1 / 10 second
    else
    {
	shutterTime = shutterTime * 8;
	if( shutterTime > 6000000 )
	    shutterTime = 6000000;
    }
    log( "... is now " + shutterTime );
}
*/	
function setBrightness( newBrightness )
{
    fs.writeFile( brightnessFilename, newBrightness.toString(), function(err) {
	if(err)
	    return log( "Error writing to screen brightness file: " + err);
    }); 
}

function dimScreen()
{
    if( dimmingState != DimmingStatesEnum.dimming )
    {
	dimmingState = DimmingStatesEnum.dimming;
	log( "Staring screen dimming" );
    }

    if( screenBrightness > 0 )
    {
	screenBrightness--;
	setBrightness( screenBrightness );
    }
    
    if( screenBrightness == 0 )
    {
	dimmingState = DimmingStatesEnum.dimmed;
	log( "Screen: dimming completed" );
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
	log( "Screen: brightening completed" );
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
    // this is so a failed write due to disk full won't delete the tokens.
    fs.writeFileSync( "tokens-new.json", JSON.stringify( tokens ) );
    fs.copyFileSync( "tokens-new.json", "tokens.json" );
}

function arm()
{
    setState( StatesEnum.armed );
}

// refresh tokens every 25 minutes
function refreshTokens()
{
    oauth2Client.refreshAccessToken();
    setTimeout( refreshTokens, 25 * 60 * 1000 );
}

function log( str )
{
    logging.log( str );
}

function upsCallback( oldState, newState )
{
    switch( newState )
    {
	case ups.PowerStateEnum.wallPower:
	      // Pushover notification
	  if( oldState )
	  {
	      var msg = { "message": "Power returned at " + secrets.houseName + " alarm.",
			  "title" :"Alarm system power is back." };
	      notifications.notifyNormal( msg.message, msg.title)
	      /*
	      pushover.send( msg, function( err, result ) {
		  if( err )
		      log( "Battery: Error sending push notification for power return: " + err );
		  else
		      log( "Battery: Successfully sent power return push notification" );
	      } 
	      */
	  }
	  break;

	case ups.PowerStateEnum.battery:
  	  if( oldState == ups.PowerStateEnum.wallPower )
	  {
	      // Pushover notification
	      var msg = { "message": "Power failure at " + secrets.houseName + " alarm.",
			  "title" :"Alarm system lost power",
			  "priority" : 1 };
	      notifications.notifyHighPriority( msg.message, msg.title )
	      /*
	      pushover.send( msg, function( err, result ) {
		  if( err )
		      log( "Battery: Error sending push notification for power failure: " + err );
		  else
		      log( "Battery: Successfully sent power failure push notification" );
	      } )
	      */
	      // minimize screen brightness
	  }
	  break;

	case ups.PowerStateEnum.batteryCritical:
	  // TODO: Pushover notificaton
	  var msg = { "message": "Battery power critical at " +secrets.houseName + " alarm. Shutting down alarm.",
		      "title" :"Battery power critical, Alarm system shutting down",
		      "priority" : 2, expire: 3600, retry: 5*60 };
	  notifications.notifyEmergency( msg.message, msg.title, msg.expire, msg.retry )

	  // TODO: shutdown
	  break;

    }
}
