'use strict';

/*
TODO : 
video.duration vgl met videoPoints.videoTime
auto-start? als track gekozen starten van zodra power!=0 || cadence!=0, 
auto-pause ? power!= 0 & cadence!=0 is nok, want dan kan je nooit coasten
*/

class Track {
  // read the file and store data in this.trackData
  constructor (aFile) {
    this._file = aFile;
    this.filename = aFile.name;
    this.trackData = [];
    //let self = this;
  } // constructor

  async open() {
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
          this.trackData = gpxFile.smoothGPX(this.trackData);
        }
        else {
          console.log ("unknown file format");
          reject(Error("unknown file format"));
        }
        console.log(`Track distance = ${this.trackData.TrackPoints[this.trackData.TrackPoints.length-1].totalDistance}, Video distance = ${this.trackData.VideoPoints[this.trackData.VideoPoints.length-1].totalDistance}`);
          
        this.allClimbs = this._findAllClimbs();
  
        for (let i = 0; i< this.allClimbs.length; i ++) {
          let climbDistance = this.allClimbs[i].maxDistance - this.allClimbs[i].minDistance;
          let climbElevation = this.allClimbs[i].maxElevation - this.allClimbs[i].minElevation;
          console.log(`found summit @  ${this.allClimbs[i].maxElevation}m, ${climbElevation.toFixed(0)}m over ${climbDistance.toFixed(0)}m, avg gradient = ${(100*climbElevation / climbDistance).toFixed(1)} %` );
        }
        this._initTrackInfo();
        // todo : wat als er geen elevation data in de gpx zitten?
        resolve(this);
      }.bind(this);
  
      reader.readAsText(this._file);
  
    });

  } // open

  // same as open() but from ajax
  async load(url) {
    return new Promise((resolve,reject) => {
      let xmlhttp = new XMLHttpRequest();
      let gpxxml; // the raw xml from the gpx/xml file
      xmlhttp.onreadystatechange = function() {
        if (xmlhttp.readyState == 4) {
          if (xmlhttp.status == 200) {
            gpxxml = xmlhttp.responseText;
            let rouvyXmlFile = new RouvyXmlFile();
            this.trackData = rouvyXmlFile.parseXML(gpxxml);
          }
          else {
            // TODO : dat is hier nog niet compleet; gaat fout 
            console.log ("http error");
            reject(Error("http error"));
          }
          // todo : support gpx links
          console.log(`Track distance = ${this.trackData.TrackPoints[this.trackData.TrackPoints.length-1].totalDistance}, Video distance = ${this.trackData.VideoPoints[this.trackData.VideoPoints.length-1].totalDistance}`);
              
          this.allClimbs = this._findAllClimbs();
    
          for (let i = 0; i< this.allClimbs.length; i ++) {
            let climbDistance = this.allClimbs[i].maxDistance - this.allClimbs[i].minDistance;
            let climbElevation = this.allClimbs[i].maxElevation - this.allClimbs[i].minElevation;
            console.log(`found summit @  ${this.allClimbs[i].maxElevation}m, ${climbElevation.toFixed(0)}m over ${climbDistance.toFixed(0)}m, avg gradient = ${(100*climbElevation / climbDistance).toFixed(1)} %` );
          }
          this._initTrackInfo();
          // todo : wat als er geen elevation data in de gpx zitten?
          resolve(this);
        } 
      }.bind(this);

      xmlhttp.open("GET", url, true);
      xmlhttp.send();

    });

  } // load

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

// shows the graphics overlay
// controls the trainer & the video playback
class Simulator {
  constructor() {
    this.isRiding = false;
    this.secUpdateTimer = null;
    this.rider = undefined;

    // the simulator is launched after onBodyLoad
    this.video = document.getElementById("myVideo");
    this.video.playbackRate = 0.0; // de playback rate wordt door de secondUpdate bijgestuurd
    this.video.pause();

    // html page info
    this.cvsMapWidth = 100;
    this.cvsMapHeight = 100;
    this.cvsProfileWidth = 500;
    this.cvsProfileHeight = 100;

    this.debugTxt = document.getElementById("debugTxt");
    this.cvsGradient = document.getElementById("cvsGradient");
    this.ctxGradient = this.cvsGradient.getContext("2d");
    this.cvsMap = document.getElementById("cvsMap");
    this.ctxMap = this.cvsMap.getContext("2d");
    this.ctxMap.strokeStyle = "#FFFFFF"; // draw white lines
    this.cvsProfile = document.getElementById("cvsProfile");
    this.ctxProfile = this.cvsProfile.getContext("2d");
    this.ctxProfile.strokeStyle = "#FFFFFF"; // draw white lines

    this.dataElapsedTime = document.getElementById("data-time");
    this.dataDistance = document.getElementById("data-dist");
    this.dataSpeed = document.getElementById("data-spd");
    this.dataAvgSpeed = document.getElementById("data-avspd");
    this.dataPower = document.getElementById("data-pow");
    this.dataAvgPower = document.getElementById("data-avpow");
    this.dataCadence = document.getElementById("data-rpm");
    this.dataAvgCadence = document.getElementById("data-avrpm");
    this.dataPowerBalance = document.getElementById("data-balance");
    this.dataAvgPowerBalance = document.getElementById("data-avbalance");
    this.dataGradient = document.getElementById("data-grad");
    this.dataAvgGradient = document.getElementById("data-avgrad");
    this.dataClimbInfo = document.getElementById("data-climb");
    this.dataAscentInfo = document.getElementById("data-ascent");
    this.dataHeartRate = document.getElementById("data-bpm");

    this.cvsMap.addEventListener('click',this.onClick.bind(this));
    this.cvsMap.addEventListener('wheel',this.onWheel.bind(this));
    this.cvsProfile.addEventListener('click',this.onClick.bind(this));
    this.cvsProfile.addEventListener('wheel',this.onWheel.bind(this));

  } // constructor

  onClick(event) {
    //log(`click on ${event.target.id} @ (${event.offsetX},${event.offsetY})`);
    // translate offsetX to curDistance
    if (event.target.id == "cvsProfile") {
      let curDistance = event.offsetX / this.cvsProfileWidth * this.track.totalDistance;
      log(`setting curDistance =  ${curDistance}`);
      this.rider.state.curDistance = curDistance;
    }
  }

  // TODO : place holders to implement zoom in & out
  onWheel(event) {
    if (event.wheelDelta > 0) {
      log (`wheel UP on ${event.target.id}`);
    } else {
      log (`wheel DOWN on ${event.target.id}`);
    }
  }

  addRider (rider) {
    this.rider = rider;
    // start the secUpdate interval, so we can see live rider data
    if (!this.secUpdateTimer) {
      this.secUpdateTimer = setInterval(() => {
        this.secUpdate();
      }, 1000);
    }
  } // addRider

  setTrack (track) {
    this.track = track;
    if (this.rider) {
      this.rider.setTrack(track);
    }
    this._initTrackImage();
    this._initProfileImage();
    this._drawData();
    let curTrackPointData = this.track.getCurTrackPointData(0);
    // show initial location yellow dots
    curTrackPointData.totalDistance = 0;
    this._showPoint(curTrackPointData);
  } // setTrack

  addGhost (ghost) {
    this.ghost = ghost;
  } // addGhost

  // load the video file in the this.video element
  loadVideoFromFile(videoFile) {
    this.video.setAttribute("src",URL.createObjectURL(videoFile));
    this.video.load();
    this.video.playbackRate = 0.0; // de playback rate wordt door de secondUpdate bijgestuurd
    this.video.loop = false;
    this.video.pause();
  } // loadVideoFromFile

  // load the video file in the this.video element
  loadVideoFromUrl(videoUrl) {
    this.video.setAttribute("src",videoUrl);
    this.video.load();
    this.video.playbackRate = 0.0; // de playback rate wordt door de secondUpdate bijgestuurd
    this.video.loop = false;
    this.video.pause();
  } // loadVideoFromUrl

  // test with youtube videos - load the video file in the this.video element using YouTubeToHtml5
  loadVideoFromYouTubeUrl(videoUrl) {
    if (!this.ytPlayer) { // start the YouTubeToHtml5
      this.ytPlayer = new YouTubeToHtml5({autoload:false});
    }
    this.video.setAttribute("data-yt2html5",videoUrl);
    this.ytPlayer.load();
    this.video.playbackRate = 0.0; // de playback rate wordt door de secondUpdate bijgestuurd
    this.video.loop = false;
    this.video.pause();
  } // loadVideoFromYouTubeUrl
  
  async start () {
    this.rider.start();

    if (!this.isRiding) {
      if (this.video.readyState) { // video selected
        this.video.play();
      }
      this.isRiding = true;
    }
  } // start

  async pause () {
    this.rider.pause();
    if (this.isRiding) {
      if (this.video.readyState) {
        this.video.pause();
      }
      this.isRiding = false;
    }
  } // pause

  async secUpdate () {
    let curTrackPointData;
    let curVideoPointData;

    if (this.rider) this.rider.secUpdate();
    //if (this.ghost) this.ghost.secUpdate();

    let r = this.rider.state; // abbreviation
    if (this.track) {
      curTrackPointData = this.track.getCurTrackPointData(r.curDistance);

      if (curTrackPointData.eof) {
        // pause the simulation
        this.pause();
        return;
      }

      // update data
      this._drawData();

      // update the gradient canvas
      // gradient canvas represents the gradient for the next 30 seconds
      let startDistance = r.curDistance;
      let canvasDistance = 30.0*r.curSpeed;
      let gradients = this.track.getGradientsOverDistance(startDistance, startDistance + canvasDistance);
      let iDistance = startDistance;
      for (let iGradient = 0; iGradient < gradients.length; iGradient++) {
        this._drawGradient(gradients[iGradient].gradient, 
                          (iDistance - startDistance) / canvasDistance, 
                          (iDistance + gradients[iGradient].distance - startDistance) / canvasDistance );
        iDistance += gradients[iGradient].distance;
      }

      // clear the end of the canvas when nearing the end of the ride
      if (canvasDistance > iDistance - startDistance) {
        this._drawGradient(0,(iDistance - startDistance) / canvasDistance, 1.0);
      }

      // update the profile & map canvas
      curTrackPointData.totalDistance = r.curDistance;
      this._showPoint(curTrackPointData);

      if (this.video.readyState) { // video chosen
        // 3. set playbackRate
        curVideoPointData = this.rider.track.getCurVideoPointData(r.curDistance);

        let playbackRate;
        if (r.curPower < 1 || curVideoPointData.videoSpeed < 0.01) {
          // stop de video als je stopt met trappen; anders stopt de video nooit in een afdaling
          playbackRate = 0.0;
        }
        else {
          playbackRate = r.curSpeed / curVideoPointData.videoSpeed;
        }
        
        if (Math.abs(curVideoPointData.videoSeconds - this.video.currentTime) > 5.0) {
          // not trying to catch up; jump straight to the currentTime;
          this.video.currentTime = curVideoPointData.videoSeconds;
        }
        else if (playbackRate) { // if curSpeed == 0 --> we want the video to stop immediately
          playbackRate += 0.1*(curVideoPointData.videoSeconds - this.video.currentTime);
          if (this.video.playbackRate) {
            if (playbackRate > this.video.playbackRate*1.1)
              playbackRate = this.video.playbackRate*1.1;
            else if (playbackRate < this.video.playbackRate*0.9)
              playbackRate = this.video.playbackRate*0.9;        
          }
        }
        if (playbackRate < 0.1) playbackRate = 0;
        if (this.video.playbackRate != playbackRate) this.video.playbackRate = playbackRate;
          
        //console.log("delta : " + (video.currentTime - curVideoSeconds).toFixed(2) + "pbrate : " + playbackRate.toFixed(2) + "speed : " + (curSpeed*3.6).toFixed(2));
  
      } // video chosen
    } // active track
  } // secUpdate

  // draw data (currently text format)
  _drawData() {

    //show live rider data
    let r = this.rider.state; // abbreviation
    if (r) {
      let avgSpeed = r.curSpeed, avgCadence = r.curCadence, avgPower = r.curPower;
      let avgPedalPowerBalance =r.curPedalPowerBalance;
      if (r.totalTime) {
        avgSpeed = (r.totalSpeed*3.6/r.totalTime);
        avgPower = (r.totalPower/r.totalTime);
        avgCadence = (r.totalCadence/r.totalTime);
        if (r.totalPower) {
          avgPedalPowerBalance = (r.totalPedalPowerBalance/r.totalPower)*100.0;
        }
      }
      this.dataSpeed.innerHTML = `${(r.curSpeed*3.6).toFixed(2)}`;
      this.dataAvgSpeed.innerHTML = `${avgSpeed.toFixed(1)}`;

      this.dataPower.innerHTML = `${r.curPower}`;
      this.dataAvgPower.innerHTML = `${avgPower.toFixed(0)}`;
      this.dataCadence.innerHTML = `${r.curCadence}`;
      this.dataAvgCadence.innerHTML = `${avgCadence.toFixed(0)}`;
      this.dataPowerBalance.innerHTML = `${r.curPedalPowerBalance}/${(100-r.curPedalPowerBalance)}`;
      this.dataAvgPowerBalance.innerHTML = `${avgPedalPowerBalance.toFixed(0)}/${(100-avgPedalPowerBalance).toFixed(0)}`;
      this.dataHeartRate.innerHTML = `${r.curHeartRate}`;

      this.debugTxt.innerHTML = "";
    }

    // show track data
    if (this.rider.track) {
      let t = this.rider.track;
      let curTrackPointData = this.track.getCurTrackPointData(r.curDistance);

      this.dataElapsedTime.innerHTML = `${sec2string(r.totalTime)}`;
      this.dataDistance.innerHTML = `${r.curDistance.toFixed(0)}m`;
      this.dataDistance.innerHTML += ` &rarr; ${(t.totalDistance - r.curDistance).toFixed(0)}m`
  
      //this.debugTxt.innerHTML += ` &#x2726; alt: ${r.curElevation.toFixed(0)}m @ ${(curTrackPointData.gradient*100.0).toFixed(1)}%`;
      this.dataGradient.innerHTML = `${(curTrackPointData.gradient*100.0).toFixed(1)}`;
      //this.debugTxt.innerHTML += " resistance = " + this.rider.trainer.bikeData.resistanceLevel;
      this.dataAscentInfo.innerHTML = `&uarr; ${(t.totalAscent - r.totalAscent).toFixed(0)}m`;
      this.dataAscentInfo.innerHTML += ` &darr; ${(t.totalDescent - r.totalDescent).toFixed(0)}m`;

      this.debugTxt.innerHTML += "<br> ";

      // show climbs
      // curTrackPointData.climb
      if (curTrackPointData.climb.onClimb) {
        let curClimb = curTrackPointData.climb.curClimb;
        let climbDistanceLeft = curClimb.maxDistance - r.curDistance;
        let climbElevationLeft = curClimb.maxElevation - r.curElevation;
        // this.debugTxt.innerHTML += `this climb (${curClimb.index+1}/${t.numClimbs}): ${climbDistanceLeft.toFixed(0)} m @ ${(100*climbElevationLeft / climbDistanceLeft).toFixed(1)}%`;
        this.dataClimbInfo.innerHTML = `(${curClimb.index+1}/${t.numClimbs}) ${climbDistanceLeft.toFixed(0)} m @ ${(100*climbElevationLeft / climbDistanceLeft).toFixed(1)}%`;
      }
      else {
        let nextClimb = curTrackPointData.climb.nextClimb;
        if (nextClimb) {
          let distFromClimb = nextClimb.minDistance - r.curDistance;
          let climbElevation = nextClimb.maxElevation - nextClimb.minElevation;
          let climbDistance = nextClimb.maxDistance - nextClimb.minDistance;
          //this.debugTxt.innerHTML += `next climb (${nextClimb.index+1}/${t.numClimbs}) in ${distFromClimb.toFixed(0)}m, ${climbDistance.toFixed(0)}m @ ${(100*climbElevation / climbDistance).toFixed(1)}%`;
          this.dataClimbInfo.innerHTML = `(${nextClimb.index+1}/${t.numClimbs}) ${climbDistance.toFixed(0)}m @ ${(100*climbElevation / climbDistance).toFixed(1)}%`;
          this.dataClimbInfo.innerHTML += "<br>";
          this.dataClimbInfo.innerHTML += `in ${distFromClimb.toFixed(0)}m`;
        }
      }

      // show avg gradient over next km
      // this.debugTxt.innerHTML += ` &#x2726; next km @ ${(100*curTrackPointData.avgGradient).toFixed(2)}%`
      this.dataAvgGradient.innerHTML = `1km @ ${(100*curTrackPointData.avgGradient).toFixed(1)}%`;
    } // data shown when track active

    // show ghost data
    if (this.ghost) {
      this.debugTxt.innerHTML += "<br>ghost: ";
      let curPos = {};
      curPos.totalDistance = this.rider.state.curDistance;
      curPos.elapsedTime = this.rider.state.totalTime;
      let ghostData = this.ghost.compareGhost(curPos);
      this.debugTxt.innerHTML += `${ghostData.curSpeed.toFixed(2)}km/h &#x2726; ${ghostData.curPower}W`;
      let ghostTimeDiff = ghostData.elapsedTime - curPos.elapsedTime;
      let ghostDistDiff = ghostData.totalDistance - curPos.totalDistance;
      if ((ghostTimeDiff < 0) || (ghostDistDiff > 0))  {
        this.debugTxt.innerHTML += ` &#x2726; ahead by ${sec2string((-ghostTimeDiff).toFixed(1))}, ${ghostDistDiff.toFixed(0)}m`;
      } else {
        this.debugTxt.innerHTML += ` &#x2726; behind by ${sec2string(ghostTimeDiff.toFixed(1))}, ${(-ghostDistDiff).toFixed(0)}m`;
      }
    } // ghost
  } // _drawData

  // draws a section of the gradient canvas with gradient (color); the section runs from startPercent (0..1) to endPercent (0..1) 
  _drawGradient (gradient, startPercent, endPercent) {
    // height 15 versie
    var yMin = 0, yMax = 0;
    const canvasHeight = 15;
    if (gradient > 0) {
      // filling the upper part of the canvas section
      yMax = 12;
      yMin = Math.max(Math.floor(12-gradient*100.0),0);
    }
    else if (gradient < 0) {
      // filling the lower part of the canvas section
      yMin = 12;
      if (gradient > -0.02) yMax = 13;
      else yMax = 14;
    }
    
    // length of the fill -> from startPercent to endPercent
    // 500 = length of the total canvas
    var xMin = Math.round(startPercent*500);
    var xMax = Math.round(endPercent*500);
    
    // determine the fill color
    var color; 
    if (gradient < 0.0) color = "#174c9a"; // kinomap blue
    else if (gradient < 0.02) color = "#17711d"; // kinomap green
    else if (gradient < 0.04) color = "#94981d"; // yellow :  #FFFF00, kinomap yellow : 94981d
    else if (gradient < 0.08) color = "#FF8C00"; // dark orange kinomap : 944c1d
    else if (gradient < 0.1) color = "#941b1d"; // red #FF0000 // 941b1d : kinomap red
    else color = 'purple'; // your face color when riding this gradient
    
    // do the filling - empty the section first
    this.ctxGradient.clearRect(xMin,0, xMax-xMin,canvasHeight);
    this.ctxGradient.fillStyle = color;
    this.ctxGradient.fillRect(xMin,yMin, xMax-xMin,yMax-yMin);
  } // _drawGradient

  _lonlat2map (point) {
    let xy = {};
    xy.x = 3 + Math.round((this.cvsMapWidth-5) * (point.lon - this.MIN.lon) / (this.MAX.lon - this.MIN.lon));
    xy.y = this.cvsMapHeight - 3 - Math.round((this.cvsMapHeight-5) * (point.lat - this.MIN.lat) / (this.MAX.lat - this.MIN.lat));
    return xy;
  } // lonlat2map

  _eledist2profile (point) {
    let profile = {};
    profile.x = 3 +Math.round((this.cvsProfileWidth - 5)* point.totalDistance / this.PROFILE.totalDistance);
    profile.y = (this.cvsProfileHeight - 3) - Math.round((this.cvsProfileHeight - 5) * (point.elevation - this.PROFILE.min) / (this.PROFILE.max - this.PROFILE.min));
    return profile;
  } // eledist2profile

  _initTrackImage () {
    // clear canvas
    this.ctxMap.clearRect(0,0,this.cvsMap.width, this.cvsMap.height);
    // create the trackImage
    let lats = this.track.trackData.TrackPoints.map(x=>x.lat);
    let lons = this.track.trackData.TrackPoints.map(x=>x.lon);
    this.MIN = {lat : Math.min(...lats), lon : Math.min(...lons)};
    this.MAX = {lat : Math.max(...lats), lon : Math.max(...lons)};
    this.ctxMap.beginPath();
    for (let i=0; i < this.track.trackData.TrackPoints.length; i++) {
      let xy = this._lonlat2map (this.track.trackData.TrackPoints[i]);
      if (i==0) {
        this.ctxMap.moveTo(xy.x, xy.y);
      }
      else {
        this.ctxMap.lineTo(xy.x, xy.y);
      }
    }
    this.ctxMap.stroke();
    this.trackImage = this.ctxMap.getImageData(0, 0, this.cvsMapWidth, this.cvsMapHeight);
  } // _initTrackImage

  _initProfileImage () {
    // clear canvas
    this.ctxProfile.clearRect(0,0,this.cvsProfile.width, this.cvsProfile.height);
    // create the profileImage
    let eles = this.track.trackData.TrackPoints.map(x=>x.elevation);
    this.PROFILE = {min : Math.min(...eles), max : Math.max(...eles)};
    this.PROFILE.totalDistance = this.track.trackData.TrackPoints[this.track.trackData.TrackPoints.length-1].totalDistance;
    this.ctxProfile.beginPath();
    for (let i=0; i < this.track.trackData.TrackPoints.length; i++) {
      let prof = this._eledist2profile (this.track.trackData.TrackPoints[i]);
      if (i==0) {
        this.ctxProfile.moveTo(prof.x, prof.y);
      }
      else {
        this.ctxProfile.lineTo(prof.x, prof.y);
      }
    }
    this.ctxProfile.stroke();
    this.profileImage = this.ctxProfile.getImageData(0, 0, this.cvsProfileWidth, this.cvsProfileHeight);
  } // _initProfileImage

  _showPoint (point) {
    this.ctxMap.clearRect(0,0,this.cvsMapWidth, this.cvsMapHeight);
    this.ctxMap.putImageData(this.trackImage, 0, 0);
    let xy = this._lonlat2map(point);
    this.ctxMap.beginPath();
    this.ctxMap.arc(xy.x,xy.y, 3, 0, 2*Math.PI);
    this.ctxMap.fillStyle = "yellow";
    this.ctxMap.fill();

    this.ctxProfile.clearRect(0,0,this.cvsProfileWidth, this.cvsProfileHeight);
    this.ctxProfile.putImageData(this.profileImage, 0, 0);
    let prof = this._eledist2profile(point);
    this.ctxProfile.beginPath();
    this.ctxProfile.arc(prof.x,prof.y, 3, 0, 2*Math.PI);
    this.ctxProfile.fillStyle = "yellow";
    this.ctxProfile.fill();
  } // _showPoint  

} // Simulator

class Rider {
  constructor(riderWeight = 83.0) {
    this._init();
    this.trainer = window.direto; // this.trainer.bikeData has the latest data reported by the trainer
    this.hrm = window.hrm; // this.hrm.heartData has the latest data reported by the hrm
    this.simPower = 200; // for simulation, 200W constant power
    this.bikeModelParams = { // bike simulation parameters
      Cd : 0.63,
      A : 0.5,
      g : 9.8067,
      Rho : 1.226,
      Crr :0.0033,
      riderWeight : riderWeight, // kg
      bikeWeight : 8.0, // kg
    };
  } // constructor

  setRiderWeight(riderWeight) {
    this.bikeModelParams.riderWeight = riderWeight;
  }

  // track is a Track class object
  // call this only after the track has been loaded from file!
  setTrack(track) {
    this._init();
    this.track = track;
    this.state.curElevation = this.track.trackData.TrackPoints[0].elevation; // rider starts at initial elevation
  } // setTrack

  // connect the direto and subscribe the bike data
  // caller try-catches errors
  async connectTrainer() {
    if (!this.trainer.connected) {
      await this.trainer.connect();
      await this.trainer.init();
      log("connectTrainer done");
      // 2019.12.18 - won't use a listener, the bikeData are available on the trainer
      //this.trainer.addEventListener('onbikedata', this._onBikeData.bind(this));
    }
  } // connectTrainer

  // disconnect the direto -unsubscribe is automatic
  // caller try-catches errors
  async disconnectTrainer () {
    if (this.trainer.connected) {
      //await direto.stop(); // ofwel failt als je al gepaused of gestopped bent
      // en dan gaat de disconnect() hierna ook niet door
      await this.trainer.disconnect();
    }
  } // disconnectTrainer

  // connect the hrm and subscribe the heart data
  // caller try-catches errors
  async connectHrm() {
    if (!this.hrm.connected) {
      await this.hrm.connect();
      await this.hrm.init();
      log("connectHrm done");
    }
  } // connectHrm

  // disconnect the hrm -unsubscribe is automatic
  // caller try-catches errors
  async disconnectHrm () {
    if (this.hrm.connected) {
      await this.hrm.disconnect();
    }
  } // disconnectHrm

  async start() {
    this.isRiding = true;
    if (this.trainer.connected) {
      await this.trainer.start().catch(()=>{});
    }
  } // start

  async pause() {
    this.isRiding = false;
    if (this.trainer.connected) {
      await this.trainer.pause().catch(()=>{});
    }
  } // pause

  // function is called every second
  async secUpdate() {
    if (this.trainer.connected) {
      if (this.trainer.bikeData.instantaneousPower != undefined) {
        this.state.curPower = this.trainer.bikeData.instantaneousPower;
        this.state.curCadence = this.trainer.bikeData.instantaneousCadence;
        // curPedalPowerBalance is systematically left side, if used with a cadence sensor
        // linked to the trainer. Without this feedback signal, left/right is a little random
        this.state.curPedalPowerBalance = this.trainer.bikeData.pedalPowerBalance;
      } else { 
        this.state.curPower = 0;
      }
    } 
    else { // no trainer connected -> use simulation data
      if (this.isRiding) {
        this.state.curPower = this.simPower; 
        this.state.curCadence = 0;
      }
      else {
        this.state.curPower = 0;
        this.state.curCadence = 0;
      }
    }
    if (this.hrm.connected) {
      if (this.hrm.heartData.heartRate != undefined) {
        this.state.curHeartRate = this.hrm.heartData.heartRate;
      } else {
        this.state.curHeartRate = 0;
      }
    }
    else { // no hrm connected -> use simulation data
      this.state.curHeartRate = 0;
    }

    if ((this.isRiding) && (this.track)) {
      this.state.curDistance += this.state.curSpeed*1.0; // 1.0 = 1 second update interval

      // avgX = totalX / totalTime; (avgPower, avgCadence, avgSpeed, avgPedalPowerBalance)
      this.state.totalTime++; // won't use bikeDataElapsedTime from the trainer
      this.state.totalPower += this.state.curPower;
      this.state.totalCadence += this.state.curCadence;
      this.state.totalSpeed += this.state.curSpeed;
      this.state.totalPedalPowerBalance += (this.state.curPedalPowerBalance*this.state.curPower)/100.0;
  
      let curInfo = this.track.getCurTrackPointData(this.state.curDistance);
      this.state.curLat = curInfo.lat;
      this.state.curLon = curInfo.lon;
  
      // keep track of total ascent / descent
      let eleDiff = curInfo.elevation - this.state.curElevation;
      if (eleDiff > 0.0) this.state.totalAscent += eleDiff;
      else this.state.totalDescent -= eleDiff;
      this.state.curElevation = curInfo.elevation;
  
      // update rideLog
      // TODO : als curSpeed 0 is, stoppen met loggen na x seconden
      let point =  {};
      point.speed = this.state.curSpeed * 3.6; //m/s to km/h
      // Date() is een functie die een lange string returnt die de current date/time voorstelt
      // new Date() creëert een object die de current date/time voorstelt -> heeft de .getTime() method
      // zo is point.time een longint ipv een lange string
      // en die longint kan je nadien opnieuw met new Date() gebruiken
      point.time = new Date().getTime();
      point.power = this.state.curPower;
      point.cadence = this.state.curCadence;
      point.lat = curInfo.lat;
      point.lon = curInfo.lon;
      point.elevation = curInfo.elevation;
      point.bpm = this.state.curHeartRate;
      this.rideLog.push(point);

      // update bike resistance based on current gradient (curInfo.gradient)
      // experimental formula for Elite Direto based on my 80kg -> TODO adapt following rider weight
      let newResistanceLevel = Math.round (Math.min(1610*curInfo.gradient + 22,200));
      // direto won't set resistance to 0
      newResistanceLevel = Math.max (newResistanceLevel, 1); 
      // we will tolerate a difference of 1 resistance unit before resending the command
      // anyway it might take several seconds for big changes in resistance to take effect
      // || 0 is needed, because the trainer doesn't report resistanceLevel if it has never been set before
      let trainerResistanceLevel = this.trainer.bikeData.resistanceLevel || 0;
      if (Math.abs(trainerResistanceLevel - newResistanceLevel) > 1) {
        this.trainer.setResistance(newResistanceLevel).catch(()=>{});
      }
      
      // update speed according to bike riding model
      let bikeModelData = {
        gradient : curInfo.gradient,
        speed : this.state.curSpeed,
        power : this.state.curPower,
      };
      this.state.curSpeed = this._runBikeModel(bikeModelData); // next 1 second we will be riding at curSpeed
    }
    else {
      this.state.curSpeed = 0.0;
    }
  } // secUpdate

  _init() {
    this.state = {
      curPower : 0,
      curCadence : 0,
      curPedalPowerBalance : 50.0,
      curHeartRate : 0,
      curSpeed : 0.0,
      curDistance : 0.0,
      curElevation : 0.0, // used to keep track of totalAscent / totalDescent
      totalTime : 0, // seconds
      totalPower : 0, // watts
      totalCadence : 0, // rpm
      totalPedalPowerBalance : 0, // %
      totalSpeed : 0.0, // km/h
      totalAscent : 0.0, // m
      totalDescent : 0.0, // m
    };
    this.track = null;
    this.rideLog = [];
    this.isRiding = false;
  } // _init

  // 1/s update of bike simulation
  /* input : { .gradient, .power, .speed}
     output : newSpeed
  */
  _runBikeModel(inData) {
    let p = this.bikeModelParams;
    let W = p.riderWeight + p.bikeWeight;
    let fResistance = p.g*Math.sin(Math.atan(inData.gradient))*W;
    fResistance+= p.g*Math.cos(Math.atan(inData.gradient))*W*p.Crr;
    fResistance += 0.5*p.Cd*p.A*p.Rho*Math.pow(inData.speed,2);
    let pResistance = fResistance*inData.speed;
    let newKineticEnergy = 0.5*W*Math.pow(inData.speed,2) - pResistance*1.0 + inData.power*1.0; // 1.0 = 1 second update of bikemodel
    let newSpeed = 0.0;
    if (newKineticEnergy >=0.0) {
      newSpeed = Math.sqrt(2*newKineticEnergy/W);
    }
    return newSpeed;
  } // _runBikeModel
  
} // Rider
  
class Ghost {
  constructor (track) {
    this.track = track;
  } // constructor

  // {curPos.totalDistance, curPos.elapsedTime}
  compareGhost (curPos) {
    let retval = {};
    let t = this.track.trackData;

    let ghostPos = 0;
    
    // when did the ghost pass at curPos.totalDistance?
    while ((t.VideoPoints[ghostPos].totalDistance < curPos.totalDistance) && (ghostPos < (t.VideoPoints.length - 1)))
      ghostPos ++;
    retval.elapsedTime = t.VideoPoints[ghostPos].videoTime; // retval.elapsedTime - curPos.elapsedTime = voorsprong van de ghost (negatief seconden)
    
    // where did the ghost pass at curPos.elapsedTime?
    ghostPos = 0;
    while ((t.VideoPoints[ghostPos].videoTime < curPos.elapsedTime) && (ghostPos < (t.VideoPoints.length - 1)))
      ghostPos ++;
    retval.totalDistance = t.VideoPoints[ghostPos].totalDistance; // retval.totalDistance - curPos.totalDistance = voorsprong van de ghost (positief meters)

    // ghost performance data
    retval.power = 0;
    if (t.TrackPoints[ghostPos].power != null) {
      retval.curPower = t.TrackPoints[ghostPos].power;
    }
    retval.curSpeed = 0.0;
    if (ghostPos > 0) {
      retval.curSpeed = 3.6 * (t.TrackPoints[ghostPos].totalDistance - t.TrackPoints[ghostPos-1].totalDistance);
      retval.curSpeed = retval.curSpeed / (t.VideoPoints[ghostPos].videoTime - t.VideoPoints[ghostPos-1].videoTime);
    }

    return retval;
  } // compareGhost

} // Ghost

  function log(line) {
    let n = Date.now() & 0xffff;
    console.log (`${n} - ${line}`);
  }

  function sec2string (timeInSeconds) {
    let retval = "";
    let ltime = timeInSeconds;
    let secs = ltime % 60;
    ltime = (ltime - secs) / 60;
    let mins = ltime % 60;
    let hours = (ltime - mins) / 60;

    if (hours != 0) {
      retval += `${hours}h`;
    }
    if ((mins != 0) || (hours!= 0)) {
      retval += `${("00" + mins).slice(-2)}m`; // truukske van internet
    }
    retval += `${("00" + secs).slice(-2)}s`; // truukske van internet

    return retval;
  } // sec2string