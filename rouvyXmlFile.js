RouvyXmlFile = function() {

  var rouvyXmlFile = {};

  // formatXML taken from https://gist.github.com/sente/1083506 (Stuart Powers)
  rouvyXmlFile.formatXML = function (xml) {
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

  rouvyXmlFile.parseHeader = function(doc) {
    // var metaData = $(doc).find('Name');
    var routeNameTag = $(doc).find('Name');
    if (routeNameTag.length > 0) {
      var routeName = routeNameTag[0].textContent;
      routeName = $.trim(routeName);
    }
    var routeDescriptionTag = $(doc).find('Description');
    if (routeDescriptionTag.length > 0) {
      var routeDescription = routeDescriptionTag[0].textContent;
      routeDescription = $.trim(routeDescription);
    }
    return {routeName: routeName, routeDescription : routeDescription};
    
  }; // parseHeader

  rouvyXmlFile.parseXML = function (xml) {
    var TrackPoints = [];
    var VideoPoints = [];

    var doc = $.parseXML(xml);
    var fileInfo = rouvyXmlFile.parseHeader(doc);
    
    // AltitudePoints
    $(doc).find('AltitudePoint').each(function(){
      var point =  {};
      point.totalDistance = Number($(this).attr("Distance"));
      point.lat = Number($(this).attr("Lat"));
      point.lon =  Number($(this).attr("Lng"));
      point.elevation =  Number($(this).attr("Alt"));
      
      TrackPoints.push(point);
    });
    
    // VideoPoints
    // for convenience push a point at the starting point
    var point = {};
    point.totalDistance = 0.0;
    point.videoTime = 0.0;
    VideoPoints.push(point);
    
    $(doc).find('VideoPoint').each(function(){
      var point =  {};
      point.totalDistance = Number($(this).attr("Distance"));
      point.videoTime = Number($(this).attr("VideoTime")); // float in seconds
      
      VideoPoints.push(point);
    });
    
    fileInfo.TrackPoints = TrackPoints;
    fileInfo.VideoPoints = VideoPoints;

    return fileInfo;
  }; // parseXML
  
  rouvyXmlFile.makeGPX = function(ridelog, trackData) {
    
  
    var emptydoc = '<?xml version="1.0"?><gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="KinomapVirtualRide" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd http://www.garmin.com/xmlschemas/GpxExtensions/v3 http://www.garmin.com/xmlschemas/GpxExtensionsv3.xsd http://www.garmin.com/xmlschemas/TrackPointExtension/v1 http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:gpxx="http://www.garmin.com/xmlschemas/GpxExtensions/v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"> \r\n \
<metadata>\r\n \
  <time>FILL-IN-STARTTIME</time>\r\n \
</metadata>\r\n \
<trk>\r\n \
  <name>GPX Trackname</name>\r\n \
  <desc>GPX Track Description</desc>\r\n \
  <trkseg>\r\n \
  </trkseg>\r\n \
</trk>\r\n \
</gpx>';
    
    var emptyTrkpt = '<trkpt lat="0.0" lon="0.0"><ele>0.0</ele><time>2017-05-10T09:00:38.000Z</time><extensions><power>122</power><gpxtpx\:TrackPointExtension><gpxtpx\:cad>57</gpxtpx\:cad></gpxtpx\:TrackPointExtension></extensions></trkpt>';
  
    var gpxDoc = $.parseXML(emptydoc);
    var metadata = $(gpxDoc).find('metadata');
    var time = metadata.find('time');
    var dt;
    if (ridelog[0].time) {
      dt = new Date(ridelog[0].time);
    }
    else {
      dt = new Date();
    }
    time[0].textContent = dt.toISOString();
    var name = $(gpxDoc).find('trk').find('name');
    name[0].textContent = trackData.routeName;
    var description = $(gpxDoc).find('trk').find('desc');
    description[0].textContent = trackData.routeDescription;
    
    var trkseg =  $(gpxDoc).find('trkseg');
    //.parseXML werkt niet met namespaces
    //var trkpt = $.parseXML(emptyTrkpt);
    //var elevation = trkpt.find("ele");
    //var power = trkpt.find("power");
    //var cadence = trkpt.find("gpxtpx\\:cad");
    
    // manually build the structure of a trackpoint
    // parsing an empty trackpoint doesn't seem to work because of the namespaces ..

    for (idx = 0; idx < ridelog.length; idx ++) {
      var trkpt = gpxDoc.createElement("trkpt");
      $(trkpt).attr("lat", ridelog[idx].lat.toFixed(7).toString()); // set the attributeName "lat" with the new value
      $(trkpt).attr("lon", ridelog[idx].lon.toFixed(7).toString());

      var elevation = gpxDoc.createElement("ele");
      elevation.appendChild(gpxDoc.createTextNode(ridelog[idx].elevation.toFixed(2).toString()));
      
      if (ridelog[idx].time) {
        var time = gpxDoc.createElement("time");
        var dt = new Date(ridelog[idx].time);
        time.appendChild(gpxDoc.createTextNode(dt.toISOString()));
        trkpt.appendChild(time);
      }

      var extensions = gpxDoc.createElement("extensions");
      if (ridelog[idx].power) {
        var power = gpxDoc.createElement("power");
        power.appendChild(gpxDoc.createTextNode(ridelog[idx].power.toString()));
        extensions.appendChild(power);
      }
      // compacter .gpx format also supported by strava
      if (ridelog[idx].cadence) {
        var cadence = gpxDoc.createElement("cadence");
        cadence.appendChild(gpxDoc.createTextNode(ridelog[idx].cadence.toString()));
        extensions.appendChild(cadence);
      }
      if (ridelog[idx].bpm) {
        var bpm = gpxDoc.createElement("heartrate");
        bpm.appendChild(gpxDoc.createTextNode(ridelog[idx].bpm.toString()));
        extensions.appendChild(bpm);
      }
/*
      if (ridelog[idx].cadence) {
        gpxtpx = gpxDoc.createElement("gpxtpx\:TrackPointExtension");
        var cadence = gpxDoc.createElement("gpxtpx\:cad");
        cadence.appendChild(gpxDoc.createTextNode(ridelog[idx].cadence.toString()));
        gpxtpx.appendChild(cadence);
        extensions.appendChild(gpxtpx);
      }
*/
      trkpt.appendChild(elevation);
      trkpt.appendChild(extensions);      
      trkseg[0].appendChild(trkpt); 
    }
    
    return(new XMLSerializer()).serializeToString(gpxDoc);
    
  } // makeGPX  

  return rouvyXmlFile;

}; // RouvyXmlFile
