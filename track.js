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
  } // loadUrl

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
    let t = this.trackData.TrackPoints;

    // 1. position info - find position in gps track 'curTrackFilePos' based on curDistance
    // in deze implementatie zoek je telkens vanaf het begin van de trackdata
    let nextTrackFilePos = 0; // temp, tot we weten hoe we via de UI in de video vooruit/achteruit gaan 
    while (t[nextTrackFilePos].totalDistance <= curDistance) {
      nextTrackFilePos++;
        if (nextTrackFilePos == t.length) break;
    }
    
    if (nextTrackFilePos == t.length) {
      returnInfo.eof = true; // end of file reached -> stop simulation
      returnInfo.lat = t[t.length-1].lat;
      returnInfo.lon = t[t.length-1].lon;
      returnInfo.elevation = t[t.length-1].elevation;
      let climbInfo = {};
      climbInfo.onClimb = false;
      climbInfo.curClimb = undefined;
      climbInfo.nextClimb = undefined;
      returnInfo.climb = climbInfo;
      returnInfo.avgGradient = 0.0;
      return returnInfo;
    }

    let gpxPartFilePos = 0.0;
    let curTrackFilePos = Math.max(nextTrackFilePos-1,0);
    while (t[curTrackFilePos].totalDistance >= t[nextTrackFilePos].totalDistance) { // fix for identical trackpoints
      curTrackFilePos--;
      if (curTrackFilePos == 0) break;
  }
    let distanceMin = t[curTrackFilePos].totalDistance;
    let distanceMax = t[Math.min(curTrackFilePos+1,t.length-1)].totalDistance + 0.1; // avoid NaN
    gpxPartFilePos = (curDistance - distanceMin) / (distanceMax - distanceMin);
    
    // find average gradient tussen 2 opeenvolgende trackpoints; eventueel is vooraf al smoothing uitgevoerd, maar niet hier!
    // curTrackFilePos gaat hier hoogstens length-2 zijn, dus curTrackFilePos+1 wijst nog steeds in de TrackPoints array
    curGradient = (t[nextTrackFilePos].elevation - t[curTrackFilePos].elevation) / (t[nextTrackFilePos].totalDistance - t[curTrackFilePos].totalDistance +0.1); //avoid NaN
    curElevation = t[curTrackFilePos].elevation + curGradient* (curDistance - t[curTrackFilePos].totalDistance);

    returnInfo.lat = t[curTrackFilePos].lat + gpxPartFilePos* (t[nextTrackFilePos].lat - t[curTrackFilePos].lat);
    returnInfo.lon = t[curTrackFilePos].lon + gpxPartFilePos* (t[nextTrackFilePos].lon - t[curTrackFilePos].lon);
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
    let v = this.trackData.VideoPoints;
    let returnInfo = {};
    // in deze implementatie zoek je telkens vanaf het begin van de trackdata
    let curVideoFilePos = 0;
    let curVideoSeconds = 0.0, curVideoSpeed = 0.0;

    // video info - find curVideoFilePos & curVideoSeconds based on curDistance
    // 1. curvideoSeconds
    while (v[curVideoFilePos].totalDistance < curDistance){
      curVideoFilePos++;
      if (curVideoFilePos == v.length) break;
    }
      
    if (curVideoFilePos == 0) {
      // we zitten vóór het eerste VideoPoint
      if (v[0].totalDistance)
        curVideoSeconds = v[0].videoTime*(curDistance / v[0].totalDistance);
    }
    else if (curVideoFilePos == v.length) {
      // we zijn voorbij het laatste video ref point
      // curVideoSeconds = interpolatie tussen [curVideoFilePos-1].videoTime en video.duration obv afgelegde afstand
      // -> 2019.12 dat doen we niet meer, want track heeft geen notie van de video zelf
      // we nemen de videoTime van het laatste VideoPoint
      curVideoSeconds = v[v.length-1].videoTime;
      //const trackTotalDistance = this.trackData.TrackPoints[this.trackData.TrackPoints.length-1].totalDistance;
      //curVideoSeconds = v[curVideoFilePos-1].videoTime + (curDistance - v[curVideoFilePos-1].totalDistance)/(trackTotalDistance - v[curVideoFilePos-1].totalDistance) * (this.video.duration - v[curVideoFilePos-1].videoTime);
    }
    else {
      // curVideoSeconds = interpolatie tussen [curVideoFilePos-1].videoTime en [curVideoFilePos].videoTime obv afgelegde afstand
      curVideoSeconds = v[curVideoFilePos-1].videoTime + (curDistance - v[curVideoFilePos-1].totalDistance)/(v[curVideoFilePos].totalDistance - v[curVideoFilePos-1].totalDistance) * (v[curVideoFilePos].videoTime - v[curVideoFilePos-1].videoTime);
    }
    
    // 2. curvideoSpeed : average speed over at least 10 seconds of video
    let videoSpeedRefPosMin, videoSpeedRefPosMax;
    if (curVideoFilePos != v.length) {
      videoSpeedRefPosMin = Math.max(0,curVideoFilePos-1);
      videoSpeedRefPosMax = videoSpeedRefPosMin + 1;
      while (v[videoSpeedRefPosMax].videoTime < curVideoSeconds + 10.0) {
        videoSpeedRefPosMax++;
        if (videoSpeedRefPosMax == v.length) break;
      }
      videoSpeedRefPosMax = Math.min(videoSpeedRefPosMax,v.length-1);
      curVideoSpeed = (v[videoSpeedRefPosMax].totalDistance - v[videoSpeedRefPosMin].totalDistance);
      curVideoSpeed = curVideoSpeed / (v[videoSpeedRefPosMax].videoTime - v[videoSpeedRefPosMin].videoTime);
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

  getGradientsOverDistance (startDistance, endDistance) {
    let t = this.trackData.TrackPoints;
    let iPos = 0;
    let gradients = [];
    let corrEndDistance = Math.min(endDistance, t[t.length-1].totalDistance);

    if (startDistance >= t[t.length-1].totalDistance) {
      return [];
    }

    // find start iPos
    while (t[iPos].totalDistance <= startDistance) {
      iPos++;
    }

    let aGradient = {};
    // van startDistance tot iPos + 1
    aGradient.distance = t[iPos].totalDistance - startDistance;
    if (aGradient.distance) {
      aGradient.gradient = t[iPos].elevation - t[iPos-1].elevation;
      aGradient.gradient /= (t[iPos].totalDistance - t[iPos-1].totalDistance);
      gradients.push(aGradient);
    }

    while (iPos < t.length-1 && t[iPos].totalDistance < corrEndDistance) {
      let aGradient = {};
      aGradient.distance = Math.min (t[iPos+1].totalDistance, corrEndDistance) - t[iPos].totalDistance;
      if (aGradient.distance) {
        aGradient.gradient = t[iPos+1].elevation - t[iPos].elevation;
        aGradient.gradient /= (t[iPos+1].totalDistance - t[iPos].totalDistance);
        gradients.push(aGradient);
      }
      iPos++;
    }
    return gradients;
  } // getGradientsOverDistance

  getAvgGradient (curDistance, distanceToAverage) {
    // todo : need helper curDistance 2 curPos!

  } // getAvgGradient

  // helper functions
  // smoothes the trackData.TrackPoints elevations in place
  _smooth(trackData) {
    let TrackPoints = trackData.TrackPoints; // dit is byReference
    let length = TrackPoints.length;
    let idx = 0;
    let startIdx = idx;
    let finishedFlag = false;
    while (!finishedFlag) {
      // elke cyclus van deze loop vindt 1 segment met een vaste gradient
      let startElevation = TrackPoints[startIdx].elevation;
      let startDistance = TrackPoints[startIdx].totalDistance;
      let localMaxElevation = startElevation;
      let localMaxIdx = startIdx;
      let localMinElevation = startElevation;
      let localMinIdx = startIdx;
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
        let gradient;
        if (TrackPoints[idx].totalDistance - startDistance == 0) gradient = 0.0; // finished on the last trackpoint
        else gradient = (TrackPoints[idx].elevation - startElevation) / (TrackPoints[idx].totalDistance - startDistance);
        let tmpIdx;
        for (tmpIdx = startIdx; tmpIdx <= idx; tmpIdx++)
          TrackPoints[tmpIdx].elevation = startElevation + gradient*(TrackPoints[tmpIdx].totalDistance - startDistance);
        startIdx = idx;
      }
      else if ((TrackPoints[idx].totalDistance - startDistance) >= 1000.0) {
        // voorlopig gebruiken we hier localMin en localMax niet
        // eventueel TODO
        // smooth tussen begin en einde == idem als hierboven
        let gradient = (TrackPoints[idx].elevation - startElevation) / (TrackPoints[idx].totalDistance - startDistance);
        let tmpIdx;
        for (tmpIdx = startIdx; tmpIdx <= idx; tmpIdx++)
          TrackPoints[tmpIdx].elevation = startElevation + gradient*(TrackPoints[tmpIdx].totalDistance - startDistance);
        startIdx = idx;
      }
      else if ((localMaxElevation - TrackPoints[idx].elevation) >= 10.0) {
        // smooth tussen startIdx en localMax, en zet de startIdx = localMaxIdx;
        let gradient = (localMaxElevation - startElevation) / (TrackPoints[localMaxIdx].totalDistance - startDistance);
        let tmpIdx;
        for (tmpIdx = startIdx; tmpIdx <= localMaxIdx; tmpIdx++)
          TrackPoints[tmpIdx].elevation = startElevation + gradient*(TrackPoints[tmpIdx].totalDistance - startDistance);
        startIdx = localMaxIdx;
      }
      else if ((TrackPoints[idx].elevation - localMinElevation) >= 10.0) {
        // smooth tussen startIdx en localMax, en zet de startIdx = localMaxIdx;
        let gradient = (localMinElevation - startElevation) / (TrackPoints[localMinIdx].totalDistance - startDistance);
        let tmpIdx;
        for (tmpIdx = startIdx; tmpIdx <= localMaxIdx; tmpIdx++)
          TrackPoints[tmpIdx].elevation = startElevation + gradient*(TrackPoints[tmpIdx].totalDistance - startDistance);
        startIdx = localMinIdx;
      }
    } // while (!finishedFlag)
    return trackData;
  } // _smooth

  // find all climbs in the (smoothed) trackData
  // climb ends if elevation decreases by more than 10 VM
  // TODO : cleanup duplicate code
  _findAllClimbs () {
    let t = this.trackData.TrackPoints;
    const state_findingStartOfClimb = 0;
    const state_findingEndOfClimb = 1;
    const minClimbElevation = 10.0; // parameter for the algorithm
    let allClimbs = [];
    
    let stateAlgo = state_findingStartOfClimb;
    let pos = 0;
    let climbStartPos = 0;
    let climbEndPos = 0;
    let refElevation = t[0].elevation;
    
    while (pos < (t.length - 1)) {
      pos ++;
      if (stateAlgo == state_findingStartOfClimb) {
        if (t[pos].elevation > refElevation) {
          // we are climbing -> let's now find the end of this climb
          stateAlgo = state_findingEndOfClimb;
          climbStartPos = pos - 1;
        }
        else if (t[pos].elevation < refElevation) {
          // we are not climbing, keep searching
        }
        refElevation = t[pos].elevation;
      }
      else if (stateAlgo == state_findingEndOfClimb) {
        if (t[pos].elevation > refElevation) {
          refElevation = t[pos].elevation;
          climbEndPos = pos;
        }
        if (t[pos].elevation < (refElevation - minClimbElevation)) {
          // back in a descent; did we find a climb?
          if ( (t[pos].elevation - t[climbStartPos].elevation) > minClimbElevation ) {
            // we need at least 10m of elevation difference to qualify it as a 'climb'
            let climb = {};
            climb.index = allClimbs.length;
            climb.startPos = climbStartPos;
            climb.endPos = climbEndPos;
            climb.minElevation = t[climbStartPos].elevation;
            climb.maxElevation = t[climbEndPos].elevation;
            climb.minDistance = t[climbStartPos].totalDistance;
            climb.maxDistance = t[climbEndPos].totalDistance;
            allClimbs.push(climb);
          }
          else {
            // startPos is just a hump in the road; let's restart the search for a climb
          }
          stateAlgo = state_findingStartOfClimb; // start finding next climb
          refElevation = t[pos].elevation;
        }
      }
    }
    // did we leave the loop in the middle of a climb -> let's count it in
    if ((stateAlgo == state_findingEndOfClimb) && ((t[climbEndPos].elevation - t[climbStartPos].elevation) > minClimbElevation)) {
      let climb = {};
      climb.index = allClimbs.length;
      climb.startPos = climbStartPos;
      climb.endPos = climbEndPos;
      climb.minElevation = t[climbStartPos].elevation;
      climb.maxElevation = t[climbEndPos].elevation;
      climb.minDistance = t[climbStartPos].totalDistance;
      climb.maxDistance = t[climbEndPos].totalDistance;
      allClimbs.push(climb);
    }
    
    return allClimbs;
  } // _findAllClimbs

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

  /* return :
  [ {distance: , gradient : },...]
  */
  
  _calcGradientOverDistance (curPos, distance) {
    let t = this.trackData.TrackPoints;
    let refElevation = curPos.elevation;
    let refDistance = Math.min (curPos.distance + distance, t[t.length-1].totalDistance); // refDistance not beyond the end of the track
    
    // find elevation at refDistance + distance;
    let pos = 0;
    while ((t[pos].totalDistance <= refDistance) && (pos < t.length-1)) {
       pos++;
    }
    // refDistance ligt nu ts prevpos (pos-1 meestal, maar soms zijn er identieke trackpoints) en pos
    let prevpos = pos-1;
    while ((prevpos > 0) && (t[prevpos].totalDistance >= t[pos].totalDistance) && (t[prevpos].totalDistance >= curPos.distance)) {
      prevpos--;
   }    
    let frx = (refDistance - t[prevpos].totalDistance) / (t[pos].totalDistance - t[prevpos].totalDistance + 0.1); // 0.1:avoid NaN
    refElevation = t[pos-1].elevation + frx*(t[pos].elevation - t[prevpos].elevation);
    return ((refElevation - curPos.elevation)/(refDistance - curPos.distance));
  } // _calcGradientOverDistance  

} // Track