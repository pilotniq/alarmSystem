var ws;
var armCountdownTimer, disarmCountdownTimer;
var myLocation;

function reconnect()
{
    ws = new WebSocket('ws://hallen.local/websocket')
    
    console.log( "Reconnecting..." );
    
    ws.onopen = function() {
        console.log( "Websocket connection opened." );
    };
    
    ws.onmessage = function (evt) {
        var text_msg = evt.data;
        console.log("Message is received...:" + text_msg);
	
        msg = JSON.parse( text_msg );
        switch( msg.type )
        {
            case 'stateChange':
              setState( msg.state );
              state = msg.state;
            
              break;

            default:
              console.log( "ERROR: Unknown message type " + msg.type );
        }
    };

    ws.onclose = function() {
        // websocket is closed.
        console.log("Websocket connection is closed...");
        setState( "disconnected" );
        reconnect();
        // var ws = new WebSocket('ws://hallen.local/websocket')
    };
}

function setState( newState )
{
    // document.getElementById("state").innerHTML = newState;
    
    // hide all state-specific divs
    var alarmStateDivs = document.getElementsByClassName("alarm-state-specific");
    var i;
    var stateDiv;

    if( armCountdownTimer )
    {
	clearTimeout( armCountdownTimer )
	armCountdownTimer = undefined
    }
    
    if( disarmCountdownTimer )
    {
	clearTimeout( disarmCountdownTimer )
	disarmCountdownTimer = undefined
    }
    
    for( i = 0; i < alarmStateDivs.length; i++ )
	alarmStateDivs[i].style.display = "none";

	stateDiv = document.getElementById("alarm-" + newState); //
	if( stateDiv )
		stateDiv.style.display = "block";

        switch( newState )
        {
          case "waitForArm":
	    armCountdownTimer = setupTimer( "armCountdownTimer", 60 ); // todo: get timeout from backend
	    // fall-through
         case "disconnected":
         case "disarmed":
            document.getElementById("disarmKeypad").style.display = "none";
            break;
      
          case "waitForDisarm":
	    disarmCountdownTimer = setupTimer( "disarmCountdownTimer", 60 ); // todo: get timeout from backend
	    // fall-through
	    
          case "preTrigger":
          case "armed":
          case "triggered":
            document.getElementById("disarmKeypad").style.display = "block";
            // document.getElementById("disarmButton").style.display = "inline-block";
            break;
      
          default:
            alert("Invalid state: " + newState );
	}
      }

      function setupTimer( elementName, timeSeconds )
      {
          document.getElementById( elementName ).innerHTML = timeSeconds;
	  return setTimeout( function () { decrementTimeout( elementName, timeSeconds ) }, 1000 )
      }

function decrementTimeout( elementName, oldSeconds )
{
    var newTime = oldSeconds - 1

    if( newTime == 0 )
	document.getElementById( elementName ).innerHTML = "";
    else
    {
	document.getElementById( elementName ).innerHTML = newTime;
	setTimeout( function () { decrementTimeout( elementName, newTime ) }, 1000 )
    }
}

function arm()
{
	var msg = { "command": "arm" };
			
        ws.send( JSON.stringify( msg ) );
}
      
      function disarm( pin )
      {
			var msg = { "command": "disarm" };
			if( pin )
			msg.pin = pin;
	ws.send( JSON.stringify( msg ));
      }

      function trigger()
	{
	  var msg = { "command": "trigger" };		
        ws.send( JSON.stringify( msg ) );
      }

      // from https://www.w3schools.com/w3css/w3css_tabulators.asp
      function displayTab( tabName )
      {
        var i;
        const contentTabName = tabName + "TabContent";
        const buttonName = tabName + "TabButton";
      
        var x = document.getElementsByClassName("tabContents");
        for (i = 0; i < x.length; i++) {
	  x[i].style.display = "none";
	}
	document.getElementById(contentTabName).style.display = "block";

	var buttons = document.getElementsByClassName("tabButton");
	for (i = 0; i < buttons.length; i++) {
	  if( buttons[i].id == buttonName )	
	    buttons[i].className = "tabButton selected";
	  else
	    buttons[i].className = "tabButton";
	}
      }
			
      function doKeypad( button )
      {
	var pinElement;
	var pinText;
			
	pinElement = document.getElementById( "pin" );
			
	console.log( "Key: " + button.innerHTML );

	var pinText = pinElement.innerHTML;

	var index = pinText.indexOf( "-" );
			
	pinText = pinText.substring( 0, index ) + button.innerHTML + pinText.substring( index + 1, 4 ); 

	if( index == 3 )
	{
			disarm( pinText );
			pinElement.innerHTML = "----";
	}
	else
	  pinElement.innerHTML = pinText;
      }

function getLocationAndWeather()
{
    var url = "http://hallen.local/location";

    fetch( url, { mode: "cors" } )
	.then( function( response ) {
	    return response.json();
	} )
	.then( function( loc ) {
	    myLocation = loc
	    console.log( "Got location: " + JSON.stringify( loc ) )
	    getWeather()
	} )
}

function getWeather()
{
    var url = "https://api.met.no/weatherapi/locationforecast/1.9/?lat=" + myLocation.latitude + "&lon=" + myLocation.longitude +
	"&msl=" + myLocation.altitude;
    var xhttp = new XMLHttpRequest();
	  xhttp.onreadystatechange = function() {
	  if (this.readyState == 4 && this.status == 200) {
	    var product, weather
	    var temperature, windDirection, windSpeed, symbol
	    var currentToTime, currentForecastToTime
	    var forecast, forecastCounter = 0
			
	    // Typical action to be performed when the document is ready:
	    weather = xhttp.responseXML

	    // delete forecast symbols
	    forecastNode = document.getElementById( "forecast" );
	    while (forecastNode.firstChild) {
	      forecastNode.removeChild(forecastNode.firstChild);
	    }
			
	    console.log( "Weather: " + xhttp.responseXML );
	    product = weather.getElementsByTagName("product")[0];
	    for( i = 0; i < product.children.length; i++ )
	    {
	      var timeNode = product.children[i];
			    
              if( timeNode.tagName != "time" )
	        continue;

	      var toTime = timeNode.attributes.getNamedItem( "to" ).value
	      console.log( "toTime;" + toTime )

	      const location = timeNode.children[0];
              if( location.tagName != "location" )
	        continue;

			    
	     if( currentToTime && (toTime != currentToTime) )	      {
	        // current conditions have been obtained. Create forecast blocks for the future.

	        if( currentForecastToTime && (toTime != currentForecastToTime) )
		{
   	          var div, img, timeSpan
		  var hours = new Date( currentForecastToTime ).getHours()

		  // make block of prev forecast
		  div = document.createElement( "li" )
		  div.className = "forecastBlock";	    
		  img = document.createElement( "img" )
		  img.src = "https://api.met.no/weatherapi/weathericon/1.1/?symbol=" + forecast.symbol + "&content_type=image/svg%2Bxml"
	          img.className = "smallWeatherSymbol"
		    timeSpan = document.createElement( "span" );
			    timeSpan.innerHTML = hours + ":00"
			    br1 = document.createElement( "br" );
			    br2 = document.createElement( "br" );
			    tempSpan = document.createElement( "span" );
			    tempSpan.innerHTML = forecast.temperature

			    div.append( img )
			    div.append( br1 )
			    div.append( timeSpan )
			    div.append( br2 )
			    div.append( tempSpan )

			    document.getElementById( "forecast" ).append( div );
			    
			    forecastCounter++;

			    if( forecastCounter == 12 )
			      break; // max 12 hourly forecast
			    forecast = {}
			      currentForecastToTime = toTime;
               }
			    if( !currentForecastToTime )  // for first time
			    {
			      currentForecastToTime = toTime;
		              forecast = {}	    
                            }
		appendToForecast( forecast, location );
	      }
	      else
	      {
			    if( !currentToTime )
			    {
			    currentToTime = toTime;
			    forecast = {}
			    }
 			    
                appendToForecast( forecast, location );
	        // if( temperature && windSpeed && windDirection && symbol )
                //  break;
   	        if( "temperature" in forecast && "windSpeed" in forecast && "windDirection" in forecast && "symbol" in forecast )
	        {		    
                  document.getElementById("temperature").innerHTML = forecast.temperature
	          document.getElementById("windSpeed").innerHTML = forecast.windSpeed
	          document.getElementById("windDirection").innerHTML = forecast.windDirection

	          document.getElementById("weatherSymbolImage").src = "https://api.met.no/weatherapi/weathericon/1.1/?symbol=" + forecast.symbol + "&content_type=image/svg%2Bxml"
                }
	      } // end of loop over location children
                // break;
	    } // end of loop over product children

	    // img = document.createElement( "img" )
	    // img.className = "weatherSymbol"
	    // img.src = 
	    // document.getElementById("weatherSymbol").appendChild( img )
	    setTimeout( getWeather, 60 * 60 * 1000 ); // update weather every hour	      
	  }
	};
	xhttp.open("GET", url, true);
	xhttp.send();
      }

function appendToForecast( forecast, location )
      {
        for( var j = 0; j < location.children.length; j++ )
	{
	  var child = location.children[j];
          var value;

	  switch( child.tagName )
          {
            case "temperature":
	      value = child.attributes.getNamedItem( "value" ).value
	      break;	      

            case "windSpeed":
	      value = child.attributes.getNamedItem( "mps" ).value
	      break;

            case "windDirection":
	      value = child.attributes.getNamedItem( "name" ).value
	      break;

            case "symbol":
	      value = child.attributes.getNamedItem( "number" ).value
	      break;
	  }
          forecast[ child.tagName ] = value
        } // end of for loop
      } // end of function
