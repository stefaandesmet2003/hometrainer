'use strict';

class Track {
  // read the file and store data in this.trackData
  constructor (aFile) {
    this._file = aFile;
    this.filename = aFile.name;
    this.trackData = [];
    let self = this;
  } // constructor

  async loadFile() {
    return new Promise((resolve,reject) => {
      let fileExtension =  this.filename.split('.').pop();
      let reader = new FileReader();
      let gpxxml; // the raw xml from the gpx file
      reader.onload = function() {
        gpxxml = reader.result;
        if (fileExtension == "xml") {
          let rouvyXmlFile = new RouvyXmlFile();
          this.trackData = rouvyXmlFile.parseXML(gpxxml);
        }
        else if (fileExtension == "gpx") {
          let gpxFile= new GPXFile();
          this.trackData = gpxFile.parseGPX(gpxxml);
          this.trackData = this._smooth(this.trackData);
        }
        else {
          console.log ("unknown file format");
          reject(Error("unknown file format"));
        }
        this.allClimbs = this._findAllClimbs();
        this._initTrackInfo();
        // todo : wat als er geen elevation data in de gpx zitten?
        resolve(this);
      }.bind(this);
      reader.readAsText(this._file);
    });

  } // loadFile

  // same as loadFile() but load data from url
  async loadUrl(url) {
    self = this;
    return axios.get(url)
    .then((res) => {
      let gpxxml = res.data;
      let rouvyXmlFile = new RouvyXmlFile();
      self.trackData = rouvyXmlFile.parseXML(gpxxml);
      this.trackData = this._smooth(this.trackData);
      // todo : support gpx links
          
      self.allClimbs = self._findAllClimbs();
      self._initTrackInfo();
      // todo : wat als er geen elevation data in de gpx zitten?
      // 04/2023 : wat moet ik nu hiermee?
      //resolve(this);
      return (this); // gokje..
    },(err) => {
      console.log(err);
      // 04/2023 : wat moet ik nu hiermee?
      //reject(Error("http error"));
      return(Error("http error")); // gokje..
    });
  } // loadurl

  // smoothes the trackData.TrackPoints elevations in place
  _smooth(trackData) {
    var TrackPoints = trackData.TrackPoints; // dit is byReference
    var length = TrackPoints.length;
    var idx = 0;
    var startIdx = idx;
    var finishedFlag = false;
    while (!finishedFlag) {
      // elke cyclus van deze loop vindt 1 segment met een vaste gradient
      var startElevation = TrackPoints[startIdx].elevation;
      var startDistance = TrackPoints[startIdx].totalDistance;
      var localMaxElevation = startElevation;
      var localMaxIdx = startIdx;
      var localMinElevation = startElevation;
      var localMinIdx = startIdx;
      // zoek de volgende reference elevation : curElevation +- 10m, of local max/min, of niet verder dan 1km
      while ( (idx < length) &&
              (Math.abs(startElevation - TrackPoints[idx].elevation) < 10.0) && 
              ((TrackPoints[idx].totalDistance - startDistance) < 1000.0) &&
              ((localMaxElevation - TrackPoints[idx].elevation) < 10.0) &&
              ((TrackPoints[idx].elevation - localMinElevation) < 10.0)) {
        if (TrackPoints[idx].elevation > localMaxElevation) {
          localMaxElevation = TrackPoints[idx].elevation;
          localMaxIdx = idx;
        }
        if (TrackPoints[idx].elevation < localMinElevation) {
          localMinElevation = TrackPoints[idx].elevation;
          localMinIdx = idx;
        }
        idx++;
      }
      //nu weten we niet door welke voorwaarde de while is gestopt.. kan beter zeker?
      if (idx == length) {
        finishedFlag = true;
        idx--;
      }
      if ((Math.abs(startElevation - TrackPoints[idx].elevation) >= 10.0) || (finishedFlag)) {
        // 10m hoogteverschil tussen startIdx en idx -> smoothen
        var gradient = (TrackPoints[idx].elevation - startElevation) / (TrackPoints[idx].totalDistance - startDistance);
        var tmpIdx;
        for (tmpIdx = startIdx; tmpIdx <= idx; tmpIdx++)
          TrackPoints[tmpIdx].elevation = startElevation + gradient*(TrackPoints[tmpIdx].totalDistance - startDistance);
        startIdx = idx;
      }
      else if ((TrackPoints[idx].totalDistance - startDistance) >= 1000.0) {
        // voorlopig gebruiken we hier localMin en localMax niet
        // eventueel TODO
        // smooth tussen begin en einde == idem als hierboven
        var gradient = (TrackPoints[idx].elevation - startElevation) / (TrackPoints[idx].totalDistance - startDistance);
        var tmpIdx;
        for (tmpIdx = startIdx; tmpIdx <= idx; tmpIdx++)
          TrackPoints[tmpIdx].elevation = startElevation + gradient*(TrackPoints[tmpIdx].totalDistance - startDistance);
        startIdx = idx;
      }
      else if ((localMaxElevation - TrackPoints[idx].elevation) >= 10.0) {
        // smooth tussen startIdx en localMax, en zet de startIdx = localMaxIdx;
        var gradient = (localMaxElevation - startElevation) / (TrackPoints[localMaxIdx].totalDistance - startDistance);
        var tmpIdx;
        for (tmpIdx = startIdx; tmpIdx <= localMaxIdx; tmpIdx++)
          TrackPoints[tmpIdx].elevation = startElevation + gradient*(TrackPoints[tmpIdx].totalDistance - startDistance);
        startIdx = localMaxIdx;
      }
      else if ((TrackPoints[idx].elevation - localMinElevation) >= 10.0) {
        // smooth tussen startIdx en localMax, en zet de startIdx = localMaxIdx;
        var gradient = (localMinElevation - startElevation) / (TrackPoints[localMinIdx].totalDistance - startDistance);
        var tmpIdx;
        for (tmpIdx = startIdx; tmpIdx <= localMaxIdx; tmpIdx++)
          TrackPoints[tmpIdx].elevation = startElevation + gradient*(TrackPoints[tmpIdx].totalDistance - startDistance);
        startIdx = localMinIdx;
      }
    } // while (!finishedFlag)
    return trackData;
  } // _smooth

  /* adds info members to the Track object
    .totalDistance
    .numClimbs, .totalAscent, .totalDescent
    .totalVideoTime
    call after _findAllClimbs!
  */
  _initTrackInfo () {

    this.totalDistance = this.trackData.TrackPoints[this.trackData.TrackPoints.length-1].totalDistance;

    this.totalAscent = 0.0;
    this.totalDescent = 0.0;
    for (let i = 0; i < this.trackData.TrackPoints.length - 1; i++) {
      let eleDiff = this.trackData.TrackPoints[i+1].elevation - this.trackData.TrackPoints[i].elevation;
      if (eleDiff > 0.0) this.totalAscent += eleDiff;
      else this.totalDescent -= eleDiff;
    }
    this.totalVideoTime = this.trackData.VideoPoints[this.trackData.VideoPoints.length-1].videoTime;
    this.numClimbs = this.allClimbs.length;

  } // _initTrackInfo
  
  // curDistance in m
  /* returnInfo {
    .eof
    .lat, .lon, .elevation, .gradient
    .climb
    .avgGradient
  }
  */
  getCurTrackPointData (curDistance) {
    let returnInfo = {};
    let curGradient = 0.0; // %
    let curElevation = 0.0;

    // 1. position info - find position in gps track 'curTrackFilePos' based on curDistance
    // in deze implementatie zoek je telkens vanaf het begin van de trackdata
    let curTrackFilePos = 0; // temp, tot we weten hoe we via de UI in de video vooruit/achteruit gaan 
    while (this.trackData.TrackPoints[curTrackFilePos].totalDistance < curDistance) {
        curTrackFilePos++;
        if (curTrackFilePos == this.trackData.TrackPoints.length) break;
    }
    
    if (curTrackFilePos == this.trackData.TrackPoints.length) {
      returnInfo.eof = true; // end of file reached -> stop simulation
      returnInfo.lat = this.trackData.TrackPoints[this.trackData.TrackPoints.length-1].lat;
      returnInfo.lon = this.trackData.TrackPoints[this.trackData.TrackPoints.length-1].lon;
      returnInfo.elevation = this.trackData.TrackPoints[this.trackData.TrackPoints.length-1].elevation;
      let climbInfo = {};
      climbInfo.onClimb = false;
      climbInfo.curClimb = undefined;
      climbInfo.nextClimb = undefined;
      returnInfo.climb = climbInfo;
      returnInfo.avgGradient = 0.0;
      return returnInfo;
    }
    // 2019.12.07 TODO!! dit werkt niet als er 2 identieke trackpoints na elkaar in
    // de xml zitten -> distanceMin == distanceMax --> div/0!
    let gpxPartFilePos = 0.0;
    if (curTrackFilePos != this.trackData.TrackPoints.length) {
      curTrackFilePos = Math.max(curTrackFilePos-1,0);
      let distanceMin = this.trackData.TrackPoints[curTrackFilePos].totalDistance;
      let distanceMax = this.trackData.TrackPoints[Math.min(curTrackFilePos+1,this.trackData.TrackPoints.length-1)].totalDistance;
      gpxPartFilePos = (curDistance - distanceMin) / (distanceMax - distanceMin);
    }
    
    // find average gradient tussen 2 opeenvolgende trackpoints; eventueel is vooraf al smoothing uitgevoerd, maar niet hier!
    // curTrackFilePos gaat hier hoogstens length-2 zijn, dus curTrackFilePos+1 wijst nog steeds in de TrackPoints array
    curGradient = (this.trackData.TrackPoints[curTrackFilePos+1].elevation - this.trackData.TrackPoints[curTrackFilePos].elevation) / (this.trackData.TrackPoints[curTrackFilePos+1].totalDistance - this.trackData.TrackPoints[curTrackFilePos].totalDistance);
    
    curElevation = this.trackData.TrackPoints[curTrackFilePos].elevation + curGradient* (curDistance - this.trackData.TrackPoints[curTrackFilePos].totalDistance);
    // ofwel curElevation = trackData.TrackPoints[curTrackFilePos].elevation + gpxPartFilePos* (trackData.TrackPoints[curTrackFilePos+1].elevation - trackData.TrackPoints[curTrackFilePos].elevation);

    returnInfo.lat = this.trackData.TrackPoints[curTrackFilePos].lat + gpxPartFilePos* (this.trackData.TrackPoints[curTrackFilePos+1].lat - this.trackData.TrackPoints[curTrackFilePos].lat);
    returnInfo.lon = this.trackData.TrackPoints[curTrackFilePos].lon + gpxPartFilePos* (this.trackData.TrackPoints[curTrackFilePos+1].lon - this.trackData.TrackPoints[curTrackFilePos].lon);
    returnInfo.elevation = curElevation;
    returnInfo.gradient = curGradient;

    // 2 - climb info
    let climbInfo = {};
    // next summit
    let foundClimb = false;
    let i;
    for (i = 0; i< this.allClimbs.length; i++) {
      if ((this.allClimbs[i].startPos <= curTrackFilePos) && (curTrackFilePos < this.allClimbs[i].endPos)) {
        foundClimb = true;
        break;
      }
      if (this.allClimbs[i].startPos > curTrackFilePos) {
        break;
      } 
    }

    if (foundClimb) {
      climbInfo.onClimb = true;
      climbInfo.curClimb = this.allClimbs[i];
      climbInfo.nextClimb = undefined;
    }
    else if (i < this.allClimbs.length) {
      climbInfo.onClimb = false;
      climbInfo.curClimb = undefined;
      climbInfo.nextClimb = this.allClimbs[i];
    }
    else {
      climbInfo.onClimb = false;
      climbInfo.curClimb = undefined;
      climbInfo.nextClimb = undefined;
    }
    returnInfo.climb = climbInfo;
    
    // 3. gradient over next km
    let curPos = {};
    curPos.distance = curDistance;
    curPos.elevation = curElevation;
    returnInfo.avgGradient = this._calcGradientOverDistance (curPos, 1000.0);

    return returnInfo;
  } // getCurTrackPointData

  /* curDistance in m
    returnInfo {
      .videoSeconds, .videoSpeed
    }
  */
  // TODO : zorgen dat .videoSpeed niet 0 kan worden (op het eind van de VideoPoints)    
  getCurVideoPointData (curDistance) {
    let returnInfo = {};
    // in deze implementatie zoek je telkens vanaf het begin van de trackdata
    let curVideoFilePos = 0;
    let curVideoSeconds = 0.0, curVideoSpeed = 0.0;

    // video info - find curVideoFilePos & curVideoSeconds based on curDistance
    // 1. curvideoSeconds
    while (this.trackData.VideoPoints[curVideoFilePos].totalDistance < curDistance){
      curVideoFilePos++;
      if (curVideoFilePos == this.trackData.VideoPoints.length) break;
    }
      
    if (curVideoFilePos == 0) {
      // we zitten vóór het eerste VideoPoint
      if (this.trackData.VideoPoints[0].totalDistance)
        curVideoSeconds = this.trackData.VideoPoints[0].videoTime*(curDistance / this.trackData.VideoPoints[0].totalDistance);
    }
    else if (curVideoFilePos == this.trackData.VideoPoints.length) {
      // we zijn voorbij het laatste video ref point
      // curVideoSeconds = interpolatie tussen [curVideoFilePos-1].videoTime en video.duration obv afgelegde afstand
      // -> 2019.12 dat doen we niet meer, want track heeft geen notie van de video zelf
      // we nemen de videoTime van het laatste VideoPoint
      curVideoSeconds = this.trackData.VideoPoints[this.trackData.VideoPoints.length-1].videoTime;
      //const trackTotalDistance = this.trackData.TrackPoints[this.trackData.TrackPoints.length-1].totalDistance;
      //curVideoSeconds = this.trackData.VideoPoints[curVideoFilePos-1].videoTime + (curDistance - this.trackData.VideoPoints[curVideoFilePos-1].totalDistance)/(trackTotalDistance - this.trackData.VideoPoints[curVideoFilePos-1].totalDistance) * (this.video.duration - this.trackData.VideoPoints[curVideoFilePos-1].videoTime);
    }
    else {
      // curVideoSeconds = interpolatie tussen [curVideoFilePos-1].videoTime en [curVideoFilePos].videoTime obv afgelegde afstand
      curVideoSeconds = this.trackData.VideoPoints[curVideoFilePos-1].videoTime + (curDistance - this.trackData.VideoPoints[curVideoFilePos-1].totalDistance)/(this.trackData.VideoPoints[curVideoFilePos].totalDistance - this.trackData.VideoPoints[curVideoFilePos-1].totalDistance) * (this.trackData.VideoPoints[curVideoFilePos].videoTime - this.trackData.VideoPoints[curVideoFilePos-1].videoTime);
    }
    
    // 2. curvideoSpeed : average speed over at least 10 seconds of video
    let videoSpeedRefPosMin, videoSpeedRefPosMax;
    if (curVideoFilePos != this.trackData.VideoPoints.length) {
      videoSpeedRefPosMin = Math.max(0,curVideoFilePos-1);
      videoSpeedRefPosMax = videoSpeedRefPosMin + 1;
      while (this.trackData.VideoPoints[videoSpeedRefPosMax].videoTime < curVideoSeconds + 10.0) {
        videoSpeedRefPosMax++;
        if (videoSpeedRefPosMax == this.trackData.VideoPoints.length) break;
      }
      videoSpeedRefPosMax = Math.min(videoSpeedRefPosMax,this.trackData.VideoPoints.length-1);
      curVideoSpeed = (this.trackData.VideoPoints[videoSpeedRefPosMax].totalDistance - this.trackData.VideoPoints[videoSpeedRefPosMin].totalDistance);
      curVideoSpeed = curVideoSpeed / (this.trackData.VideoPoints[videoSpeedRefPosMax].videoTime - this.trackData.VideoPoints[videoSpeedRefPosMin].videoTime);
    }
    else {
      // we zijn voorbij het laatste video ref point
      // geen idee hoe lang de video nog duurt, maar de video speed gewoon aanhouden tot die stopt in de player
      // TODO we hebben wel video.duration
      curVideoSpeed = curVideoSpeed;
    }
    returnInfo.videoSeconds = curVideoSeconds;
    returnInfo.videoSpeed = curVideoSpeed;
    return returnInfo;

  } // getCurVideoPointData

  getAvgGradient (curDistance, distanceToAverage) {
    // todo : need helper curDistance 2 curPos!

  } // getAvgGradient

  // helper functions
  // find all climbs in the trackData
  // climb ends if elevation descreases by more than 10 VM
  // TODO : cleanup duplicate code
    _findAllClimbs () {

    const state_findingStartOfClimb = 0;
    const state_findingEndOfClimb = 1;
    const minClimbElevation = 10.0; // parameter for the algorithm
    let allClimbs = [];
    const length = this.trackData.TrackPoints.length;
    
    let stateAlgo = state_findingStartOfClimb;
    let pos = 0;
    let climbStartPos = 0;
    let climbEndPos = 0;
    let refElevation = this.trackData.TrackPoints[0].elevation;
    
    while (pos < (this.trackData.TrackPoints.length - 1)) {
      pos ++;
      if (stateAlgo == state_findingStartOfClimb) {
        if (this.trackData.TrackPoints[pos].elevation > refElevation) {
          // we are climbing -> let's now find the end of this climb
          stateAlgo = state_findingEndOfClimb;
          climbStartPos = pos - 1;
        }
        else if (this.trackData.TrackPoints[pos].elevation < refElevation) {
          // we are not climbing, keep searching
        }
        refElevation = this.trackData.TrackPoints[pos].elevation;
      }
      else if (stateAlgo == state_findingEndOfClimb) {
        if (this.trackData.TrackPoints[pos].elevation > refElevation) {
          refElevation = this.trackData.TrackPoints[pos].elevation;
          climbEndPos = pos;
        }
        if (this.trackData.TrackPoints[pos].elevation < (refElevation - minClimbElevation)) {
          // back in a descent; did we find a climb?
          if ( (this.trackData.TrackPoints[pos].elevation - this.trackData.TrackPoints[climbStartPos].elevation) > minClimbElevation ) {
            // we need at least 10m of elevation difference to qualify it as a 'climb'
            var climb = {};
            climb.index = allClimbs.length;
            climb.startPos = climbStartPos;
            climb.endPos = climbEndPos;
            climb.minElevation = this.trackData.TrackPoints[climbStartPos].elevation;
            climb.maxElevation = this.trackData.TrackPoints[climbEndPos].elevation;
            climb.minDistance = this.trackData.TrackPoints[climbStartPos].totalDistance;
            climb.maxDistance = this.trackData.TrackPoints[climbEndPos].totalDistance;
            allClimbs.push(climb);
          }
          else {
            // startPos is just a hump in the road; let's restart the search for a climb
          }
          stateAlgo = state_findingStartOfClimb; // start finding next climb
          refElevation = this.trackData.TrackPoints[pos].elevation;
        }
      }
    }
    // did we leave the loop in the middle of a climb -> let's count it in
    if ((stateAlgo == state_findingEndOfClimb) && ((this.trackData.TrackPoints[climbEndPos].elevation - this.trackData.TrackPoints[climbStartPos].elevation) > minClimbElevation)) {
      var climb = {};
      climb.index = allClimbs.length;
      climb.startPos = climbStartPos;
      climb.endPos = climbEndPos;
      climb.minElevation = this.trackData.TrackPoints[climbStartPos].elevation;
      climb.maxElevation = this.trackData.TrackPoints[climbEndPos].elevation;
      climb.minDistance = this.trackData.TrackPoints[climbStartPos].totalDistance;
      climb.maxDistance = this.trackData.TrackPoints[climbEndPos].totalDistance;
      allClimbs.push(climb);
    }
    
    return allClimbs;
  } // _findAllClimbs

  /* return :
  [ {distance: , gradient : },...]
  */
  getGradientsOverDistance (startDistance, endDistance) {
    let iPos = 0;
    let gradients = [];
    const length = this.trackData.TrackPoints.length;
    let corrEndDistance = Math.min(endDistance, this.trackData.TrackPoints[length-1].totalDistance);

    if (startDistance >= this.trackData.TrackPoints[length-1].totalDistance) {
      return [];
    }

    // find start iPos
    while (this.trackData.TrackPoints[iPos].totalDistance <= startDistance) {
      iPos++;
    }

    let aGradient = {};
    // van startDistance tot iPos + 1
    aGradient.distance = this.trackData.TrackPoints[iPos].totalDistance - startDistance;
    if (aGradient.distance) {
      aGradient.gradient = this.trackData.TrackPoints[iPos].elevation - this.trackData.TrackPoints[iPos-1].elevation;
      aGradient.gradient /= (this.trackData.TrackPoints[iPos].totalDistance - this.trackData.TrackPoints[iPos-1].totalDistance);
      gradients.push(aGradient);
    }

    while (iPos < length-1 && this.trackData.TrackPoints[iPos].totalDistance < corrEndDistance) {
      let aGradient = {};
      aGradient.distance = Math.min (this.trackData.TrackPoints[iPos+1].totalDistance, corrEndDistance) - this.trackData.TrackPoints[iPos].totalDistance;
      if (aGradient.distance) {
        aGradient.gradient = this.trackData.TrackPoints[iPos+1].elevation - this.trackData.TrackPoints[iPos].elevation;
        aGradient.gradient /= (this.trackData.TrackPoints[iPos+1].totalDistance - this.trackData.TrackPoints[iPos].totalDistance);
        gradients.push(aGradient);
      }
      iPos++;
    }
    return gradients;

  } // getGradientsOverDistance

  _calcGradientOverDistance (curPos, distance) {
    var refElevation = curPos.elevation;
    var refDistance;
    var pos = 0;
    const length = this.trackData.TrackPoints.length;
    
    // refDistance not beyond the end of the track
    refDistance = Math.min (curPos.distance + distance, this.trackData.TrackPoints[length-1].totalDistance );
    
    // find elevation at refDistance + distance;
    while ((this.trackData.TrackPoints[pos].totalDistance <= refDistance) && (pos < length-1)) {
       pos++;
    }
    // refDistance ligt nu ts pos-1 en pos
    var frx = (refDistance - this.trackData.TrackPoints[pos-1].totalDistance) / (this.trackData.TrackPoints[pos].totalDistance - this.trackData.TrackPoints[pos-1].totalDistance);
    var refElevation = this.trackData.TrackPoints[pos-1].elevation + frx*(this.trackData.TrackPoints[pos].elevation - this.trackData.TrackPoints[pos-1].elevation);
    
    return ((refElevation - curPos.elevation)/(refDistance - curPos.distance));
    
  } // _calcGradientOverDistance  

} // Track