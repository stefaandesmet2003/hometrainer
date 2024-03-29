'use strict';

class GPXFile {
  constructor () {
    this.track = 'unused';
  } // constructor  

  // formatXML taken from https://gist.github.com/sente/1083506 (Stuart Powers)
  formatXML (xml) {
    var formatted = '';
    var reg = /(>)(<)(\/*)/g;
    xml = xml.replace(reg, '$1\r\n$2$3');
    xml = xml.replace(/ xmlns=""/g, '');
    var pad = 0;
    jQuery.each(xml.split('\r\n'), function(index, node) {
      node = $.trim(node);
      var indent = 0;
      if (node.match( /.+<\/\w[^>]*>$/ )) {
        indent = 0;
      } else if (node.match( /^<\/\w/ )) {
        if (pad != 0) {
          pad -= 1;
        }
      } else if (node.match( /^<\w[^>]*[^\/]>.*$/ )) {
        indent = 1;
      } else {
        indent = 0;
      }
      var padding = '';
      for (var i = 0; i < pad; i++) {
        padding += '  ';
      }
      formatted += padding + node + '\r\n';
      pad += indent;
    });
    return formatted;
  }; // formatXML

  parseHeader (doc) {
    var routeName ="";
    var routeDescription ="";
    var routeNameTag;
    var routeDescriptionTag;
  
    var metaData = $(doc).find('metadata');
    // the name/desc data can also be located in the <trk> segment
    if (metaData.length > 0) {
      routeNameTag = metaData.find('name');
      if (routeNameTag.length > 0) {
        var routeName = routeNameTag[0].textContent;
        routeName = $.trim(routeName);
      }
      routeDescriptionTag = metaData.find('desc');
      if (routeDescriptionTag.length > 0) {
        routeDescription = routeDescriptionTag[0].textContent;
        routeDescription = $.trim(routeDescription);
      }
    }
    
    if (routeName.length == 0) {
      // let's try and find a route under the <trk> tag
      var trkData = $(doc).find('trk');
      routeNameTag = trkData.find('name');
      if (routeNameTag.length > 0) {
        routeName = routeNameTag[0].textContent;
        routeName = $.trim(routeName);
      }
    }
    if (routeDescription.length == 0) {
      // let's try and find a route under the <trk> tag
      var trkData = $(doc).find('trk');
      routeDescriptionTag = trkData.find('desc');
      if (routeDescriptionTag.length > 0) {
        routeDescription = routeDescriptionTag[0].textContent;
        routeDescription = $.trim(routeDescription);
      }
    }
    // fallback to default
    if (routeName.length == 0)
      routeName = "GPX route with no name";
    if (routeDescription.length == 0)
      routeDescription = "GPS route with no description";

    return {routeName: routeName, routeDescription : routeDescription};    
  }; // parseHeader

  parseGPX (xml) {
    var TrackPoints = [];
    var VideoPoints = [];
    var prevTrackPoint =  null;
    var totalDistance = 0;
    var bFoundStartTime = false;
    var startTime; // 
    var doc = $.parseXML(xml);
    
    var fileInfo = this.parseHeader(doc);
    $(doc).find('trkpt').each(function(){
      var trackPoint =  {};
      trackPoint.lat = Number($(this).attr("lat"));
      trackPoint.lon =  Number($(this).attr("lon"));
      var eleElevation = $(this).find("ele");
      if (eleElevation.length > 0) {
        trackPoint.elevation =  Number(eleElevation[0].textContent);
      } else {
        // Add the elevation, and set it to an arbitrary 100 meters because TACX
        // won't accept a track at zero elevation
        trackPoint.elevation =  100;
      }
      
      // sds : als er gpxdata:distance tags zijn gaan we die gebruiken
      // in een gpxFileTodo staan wel gpxdata:distance tags, maar geen correcte gps coordinaten
      var trkptDistance = $(this).find("gpxdata\\:distance");
      if (trkptDistance.length > 0) {
        trackPoint.totalDistance = Number(trkptDistance[0].textContent);
        totalDistance = trackPoint.totalDistance;
      }
      else {
        trackPoint.totalDistance = 0;
        if (prevTrackPoint) {
          totalDistance = prevTrackPoint.totalDistance + distVincenty(prevTrackPoint.lat, prevTrackPoint.lon, trackPoint.lat, trackPoint.lon);
          trackPoint.totalDistance = totalDistance;
        }
      }

      // ghost data ?
      let trkptPower = $(this).find("power");
      if (trkptPower.length > 0) {
        trackPoint.power = Number(trkptPower[0].textContent);
      }
      let trkptCadence = $(this).find("gpxtpx\\:cad");
      if (trkptCadence.length > 0) {
        trackPoint.cadence = Number(trkptCadence[0].textContent);
      }
      else { // alt for cadence in gpx recording
        trkptCadence = $(this).find("cadence");
        if (trkptCadence.length > 0) {
          trackPoint.cadence = Number(trkptCadence[0].textContent);
        }
      }
      
      TrackPoints.push(trackPoint);
      prevTrackPoint = trackPoint;
      
      var videoPoint = {};
      // time == video time
      videoPoint.videoTime = 0;
      videoPoint.totalDistance = totalDistance;
      
      var trkptTime =  $(this).find("time");
      if (trkptTime.length > 0) {
        var msec = Date.parse(trkptTime[0].textContent);
        var d = new Date(msec);
        if (!bFoundStartTime) {
          bFoundStartTime = true;
          startTime = d;
          videoPoint.videoTime = 0;
        }
        else {
          videoPoint.videoTime = (d - startTime)/1000.0; // float in seconds, like rouvy xml !!
        }
      }
      
      VideoPoints.push(videoPoint);

    });
    
    fileInfo.TrackPoints = TrackPoints;
    fileInfo.VideoPoints = VideoPoints;
    return fileInfo;
  }; // parseGPX
  
/*  
    var emptydoc = '<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="KinomapVirtualRide" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd http://www.garmin.com/xmlschemas/GpxExtensions/v3 http://www.garmin.com/xmlschemas/GpxExtensionsv3.xsd http://www.garmin.com/xmlschemas/TrackPointExtension/v1 http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:gpxx="http://www.garmin.com/xmlschemas/GpxExtensions/v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"> \
      <metadata>                                            \
        <time>FILL-IN-STARTTIME</time>                      \
      </metadata>                                           \
      <trk>                                                 \
        <name>GPX Trackname</name>                          \
        <desc>GPX Track Description</desc>                  \
        <trkseg>                                            \
          <trkpt lat="45.08952" lon="5.47082">              \
            <ele>663.8</ele>                                \
            <time>2017-05-10T09:00:38.000Z</time>           \
            <speed>8.9</speed>                              \
            <extensions>                                    \
              <power>122</power>                            \
              <gpxtpx:TrackPointExtension>                  \
                <gpxtpx:cad>57</gpxtpx:cad>                 \
              </gpxtpx:TrackPointExtension>                 \
            </extensions>                                   \
          </trkpt>                                          \
          <trkpt lat="45.08947" lon="5.47091">              \
            <ele>664.2</ele>                                \
            <time>2017-05-10T09:00:39.000Z</time>           \
            <speed>8.4</speed>                              \
          </trkpt>                                          \
        </trkseg>                                           \
      </trk>                                                \
    </gpx>';
*/  
  
  makeGPX (ridelog) {
    var emptydoc = '<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="KinomapVirtualRide" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd http://www.garmin.com/xmlschemas/GpxExtensions/v3 http://www.garmin.com/xmlschemas/GpxExtensionsv3.xsd http://www.garmin.com/xmlschemas/TrackPointExtension/v1 http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:gpxx="http://www.garmin.com/xmlschemas/GpxExtensions/v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"> \r\n '+
                    '<metadata>\r\n' +
                    '  <time>FILL-IN-STARTTIME</time>\r\n' +
                    '</metadata>\r\n' +
                    '<trk>\r\n' +
                    '  <name>GPX Trackname</name>\r\n' +
                    '  <desc>GPX Track Description</desc>\r\n' +
                    '  <trkseg>\r\n' +
                    '  </trkseg>\r\n' +
                    '</trk>\r\n' +
                    '</gpx>';
    
    var gpxDoc = $.parseXML(emptydoc);
    var metadata = $(gpxDoc).find('metadata');
    var time = metadata.find('time');
    var dt = new Date(ridelog[0].time);
    time[0].textContent = dt.toISOString();
    
    var trkseg =  $(gpxDoc).find('trkseg');
    // manually build the structure of a trackpoint
    // parsing an empty trackpoint doesn't seem to work because of the namespaces ..
    for (let idx = 0; idx < ridelog.length; idx ++) {
      var trkpt = gpxDoc.createElement("trkpt");
      $(trkpt).attr("lat", ridelog[idx].lat.toFixed(7).toString()); // set the attributeName "lat" with the new value
      $(trkpt).attr("lon", ridelog[idx].lon.toFixed(7).toString());

      var elevation = gpxDoc.createElement("ele");
      elevation.appendChild(gpxDoc.createTextNode(ridelog[idx].elevation.toFixed(2).toString()));

      var time = gpxDoc.createElement("time");
      var dt = new Date(ridelog[idx].time);
      time.appendChild(gpxDoc.createTextNode(dt.toISOString()));

      var extensions = gpxDoc.createElement("extensions");
      var power = gpxDoc.createElement("power");
      power.appendChild(gpxDoc.createTextNode(ridelog[idx].power.toString()));
      
      gpxtpx = gpxDoc.createElement("gpxtpx\:TrackPointExtension");
      var cadence = gpxDoc.createElement("gpxtpx\:cad");
      cadence.appendChild(gpxDoc.createTextNode(ridelog[idx].cadence.toString()));

      gpxtpx.appendChild(cadence);
      extensions.appendChild(power);
      extensions.appendChild(gpxtpx);
      trkpt.appendChild(elevation);
      trkpt.appendChild(time);
      trkpt.appendChild(extensions);      
      trkseg[0].appendChild(trkpt); 
    }
    return(new XMLSerializer()).serializeToString(gpxDoc);
    
  } // makeGPX

} // GPXFile