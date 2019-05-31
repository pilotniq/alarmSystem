const axios = require( 'axios' )
const logging = require( './logging' )

const ONTIME_MINUTES = 2
const defaultBrightness = 182
const maxBrightness = 255
      
var key
var serverName
var isOn
var timer
var isMotionTrigger

function setKey( k, sName )
{
    key = k
    serverName = sName

    turnOff()
}

function motion() {
    if( !isMotionTrigger )
    {
	log( "Ignored motion because motion trigger is off" )
	return;
    }
    
    if( !isOn )
    {
	log( "turning on due to motion" )
	
	setState( true )
	timer = setTimeout( turnOff, ONTIME_MINUTES * 60 * 1000 )
    }
    else
    {
	if( timer )
	    clearTimeout( timer )

	log( "resetting timer" )
        timer = setTimeout( turnOff, ONTIME_MINUTES * 60 * 1000 )
    }
}

function setBrightness() {

}

function turnOff()
{
    log( "turnOff" )
    
    setState( false )
    timer = undefined
}

function log( message )
{
    logging.log( "Lights: " + message );
}

async function sendCommand( command )
{
    var url = "http://" + serverName + "/api/" + key + "/lights/1/state";
    
    axios.put( url, command ).
	then( function( response ) {
	    if( response.status != 200 )
	    {
		log( "Error setting light state: " + response.status + " " + response.statusText )
	    }
	})
	.catch( function (error) {
	    log( "Error: " + error );
	});
}

async function setBrightness( brightness )
{
    var command = { bri: brightness }

    await sendCommand( command )
    log( "setBrightness(" + brightness + ")" )
}
    
async function setState( onOff )
{
    var command = { on: onOff }
    
    await sendCommand( command );

    log( "setState(" + onOff + ")" )
    
    isOn = onOff;
}

function setMotionTrigger( enabled )
{
    if( isMotionTrigger )
    {
	clearTimeout( timer )
	timer = undefined
    }
    
    isMotionTrigger = enabled

    log( "set motion trigger to " + (enabled ? "on" : "off") )
    
    if( enabled && isOn )
	timer = setTimeout( turnOff, ONTIME_MINUTES * 60 * 1000 )
}
module.exports = { setKey, motion, setBrightness, setState, setMotionTrigger, defaultBrightness, maxBrightness }
