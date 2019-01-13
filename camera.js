/*
  camera.js
*/
// const util = require('util');
// const exec = util.promisify(require('child_process').exec);
var exif = require('fast-exif');
const exec = require('await-exec')
const logging = require( './logging' )

// camera state
// lower brightnesses will give darker pictures but shorter exposure times
const minCameraBrightness = 0.07
const targetCameraBrightness = 0.08
const maxCameraBrightness = 0.1
const targetShutter_us = (1 / 90) * 1000000 // 1 / 90 seconds is sharp, no need to make sharper, let image get brighter

var exposure = { ISO: 800,
		 shutterTime_us: 0
	       }

function log( message )
{
    logging.log( "Camera: " + message );
}

// TODO: If brightness is too high at target shutter speed, decreaes ISO, and then decrease shutter speed
// anyway
function adjustExposure( brightness, exifData )
{
    if( brightness < minCameraBrightness )
    {
	if( brightness == 0 )
	{
	    log( "Brightness is zero" );
	    exposure.ISO = 800;
	    if( exposure.shutterTime_us )
		exposure.shutterTime_us = 100000; // 1 / 10 seconds
	    else
	    {
		exposure.shutterTime_us = exposure.shutterTime_us * 8;
		if( exposure.shutterTime_us > 6000000 )
		    exposure.shutterTime_us = 6000000
	    }
	}
	else
	{
	    if( !exposure.shutterTime_us )
		exposure.shutterTime_us = 179;
					      
	    newTime = Math.round(shutterTime / (brightness / targetCameraBrightness));

	    log( "Brightness was low, " + brightness + " shutter was " + exposure.shutterTime_us / 1000000 +
		 ", newTime=" + newTime / 1000000 );
	    if( newTime >= 6000000 )
		exposure.shutterTime_us = 6000000;
	    else
		exposure.shutterTime_us = newTime;

	    if( exposure.shutterTime_us < targetShutter_us )
		exposure.shutterTime_us = targetShutter_us; // accept risk of overexposure
	    log( "new shutterTime: " + exposure.shutterTime_us / 1000000.0 );
	} // end of if( brightness == 0 ) ... else ...
    } // if( brightness < minCameraBrightness )
    else if( (brightness > maxCameraBrightness) &&
	     ((exposure.shutterTime_us == 0) || (exposure.shutterTime_us > targetShutter_us) ))
    {
	if( exposure.shutterTime_us == 0 )
	{
	    //printAttributes( exifData.exif );
	    // convert to microseconds
	    exposure.shutterTime_us = Math.round(exifData.exif.ExposureTime * 1000000);
	}
	newTime = Math.round(exposure.shutterTime_us / (brightness / targetCameraBrightness));
	log( "Brightness was high, " + brightness +
	     " shutter was " + exposure.shutterTime_us / 1000000 + ", newTime=" + newTime );
	if( newTime >= 6000000 )
	    exposure.shutterTime_us = 6000000;
	else
	{
	    if( newTime < targetShutter_us )
		exposure.shutterTime_us = targetShutter_us;
	    else
		exposure.shutterTime_us = newTime;
	}
	log( "new shutterTime: " + exposure.shutterTime_us );
    }
}

async function takePicture( filename )
{
  // Mode 4 = 1296x972 resolution (1/4 of max) with 2x2 binning - but mode 4 can't do less than 1s per exposure
    
  // awbg manually sets white balance
  if( !exposure.shutterTime )
      cameraCommand = 'raspistill -awb off -awbg "1.0,1.0" --nopreview --timeout 1000 -ISO ' + exposure.ISO +
	' --quality 20 --width 1296 --height 972 -o ' + filename;
  else
      cameraCommand = 'raspistill -awb off -awbg "1.0,1.0" --nopreview --timeout 1 --quality 10 -ISO ' +
	exposure.ISO + ' --width 1296 --height 972 --shutter ' + exposure.shutterTime_us + ' -o ' + filename;

    log( "cameraCommand: " + cameraCommand );
    
    await exec( cameraCommand )
/*
    , (err, stdout, stderr) => {
	if( err )
	{
	    log( "Error taking photo" );
	    return;
	}
*/
	log( "Photo taken: " + filename );
	exif.read( filename ).then( function( exifData )
				    { var brightness = exifData.exif.BrightnessValue;
				      log( "Photo brightness: " + brightness );
				      adjustExposure( brightness, exifData )
					  // log( "exif: " + exifData );
				    });
	// function( err ) { log( "exif read error: " + err ); });
}

function getShutterTime_us()
{
    return exposure.shutterTime_us;
}

module.exports = { takePicture, getShutterTime_us }
