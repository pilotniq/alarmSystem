/*
 * UPS functionality for the alarm.
 * Uses the Geekworm UPS HAT
 */
i2c = require('async-i2c-bus')
const Max17048 = require( 'max17048' )
const logging = require( './logging.js' )

var max17048 // IC for battery monitoring
var PowerStateEnum = { 'wallPower': 'wallPower', 'battery': 'battery', 'batteryCritical': 'batteryCritical' }
var powerState
const BATTERY_CHECK_INTERVAL_SECONDS = 60;
var callback

function log( str )
{
    logging.log( "UPS: " + str );
}

async function startBatteryMonitoring( cb )
{
    const bus = i2c.Bus()
    var chargeRate;
    
    await bus.open();

    max17048 = new Max17048( bus )
    callback = cb
    
    checkBattery()
}

async function checkBattery()
{
    chargeRate = await max17048.getChargingRate()

    log( "checkBattery: Battery charge rate is " + chargeRate * 100 + " %/h" );

    // chargeRate has been reported as -4.16% while on wall power
    if( chargeRate >= -0.05 )
	setPowerState( PowerStateEnum.wallPower )
    else
    {
	var chargeState = await max17048.getStateOfCharge()
	log( "checkBattery: Battery charge is " + chargeState * 100 + " %" );

	if( chargeState < 0.1 )
	    setPowerState( PowerStateEnum.batteryCritical )
	else
	    setPowerState( PowerStateEnum.battery )
    }

    setTimeout( checkBattery, BATTERY_CHECK_INTERVAL_SECONDS * 1000 )
}

function setPowerState( newState )
{
    var oldState = powerState;

    if( oldState == newState )
	return;
    
    powerState = newState;

    log( "setPowerState: " + oldState + " -> " + newState )

    if( callback )
	callback( oldState, newState )
    else
	log( "setPowerState: no callback defined" )
}

module.exports = { PowerStateEnum, startBatteryMonitoring }

    
