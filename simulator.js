'use strict';

const SIMULATION_IDLE      = 0; // init state
const SIMULATION_READY     = 1; // track loaded (irrespective of video)
const SIMULATION_RUNNING   = 2; // start clicked
const SIMULATION_PAUSED    = 3; // pause clicked
const SIMULATION_COMPLETED = 4; // end of track reached

/*
TODO : secUpdate vanaf het begin, ook als de simulatie nog geen track heeft, of gestart is
zodat de rider data al kunnen getoond worden, en dan start doorgeven aan de rider waardoor die de time begint op te nemen
of de chronometer pas starten als er != OW of != 0 rpm wordt gezien
video.duration vgl met videoPoints.videoTime
*/

class Track {
  // read the file and store data in this.trackData
  constructor (aFile) {
    this.filename = aFile.name;
    this.trackData = [];
    //let self = this;

    let fileExtension =  this.filename.split('.').pop();
    let reader = new FileReader();
    let gpxxml; // the raw xml from the gpx file
    reader.onload = function() {
      gpxxml = reader.result;
      if (fileExtension == "xml") {
        let rouvyXmlFile= new RouvyXmlFile();
        this.trackData = rouvyXmlFile.parseXML(gpxxml);
      }
      else if (fileExtension == "gpx") {
        let gpxFile= new GPXFile(); // global of niet? in smoother.js was dit global, maar hier hebben we die niet meer nodig nadat de trackData geparsed zijn, toch?
        this.trackData = gpxFile.parseGPX(gpxxml);
        this.trackData = gpxFile.smoothGPX(this.trackData);
      }
      else {
        console.log ("unsupported file format");
        return;
      }
      console.log(`Track distance = ${this.trackData.TrackPoints[this.trackData.TrackPoints.length-1].totalDistance}, Video distance = ${this.trackData.VideoPoints[this.trackData.VideoPoints.length-1].totalDistance}`);
        
      this.allClimbs = this._findAllClimbs(this.trackData);

      for (let i = 0; i< this.allClimbs.length; i ++) {
        let climbDistance = this.allClimbs[i].maxDistance - this.allClimbs[i].minDistance;
        let climbElevation = this.allClimbs[i].maxElevation - this.allClimbs[i].minElevation;
        console.log(`found summit @  ${this.allClimbs[i].maxElevation}m, ${climbElevation.toFixed(0)}m over ${climbDistance.toFixed(0)}m, avg gradient = ${(100*climbElevation / climbDistance).toFixed(1)} %` );
      }
      // todo : wat als er geen elevation data in de gpx zitten?
    }.bind(this);

    reader.readAsText(aFile);

  } // constructor

  /* returnInfo {
    .totalDistance
    .numClimbs, .totalAscent, .totalDescent
    .totalVideoTime
  }
  */
  getTrackInfo () {
    let returnInfo = {};

    returnInfo.totalDistance = this.trackData.TrackPoints[this.trackData.TrackPoints.length-1].totalDistance;

    returnInfo.totalAscent = 0.0;
    for (let i = 0; i < this.allClimbs.length; i++) {
      let climbElevation = this.allClimbs[i].maxElevation - this.allClimbs[i].minElevation;
      returnInfo.totalAscent += climbElevation;
    }
    //returnInfo.totalDescent = 1000.0; // dit is nog niet berekend, enkel de climbs zijn getagged
    returnInfo.totalVideoTime = this.trackData.VideoPoints[this.trackData.VideoPoints.length-1].videoTime;
    returnInfo.numClimbs = this.allClimbs.length;

    return returnInfo;

  } // getTrackInfo
  
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
  _findAllClimbs (trackData) {

    const state_findingStartOfClimb = 0;
    const state_findingEndOfClimb = 1;
    const minClimbElevation = 10.0; // parameter for the algorithm
    let allClimbs = [];
    const length = trackData.TrackPoints.length;
    
    let stateAlgo = state_findingStartOfClimb;
    let pos = 0;
    let climbStartPos = 0;
    let climbEndPos = 0;
    let refElevation = trackData.TrackPoints[0].elevation;
    
    while (pos < (trackData.TrackPoints.length - 1)) {
      pos ++;
      if (stateAlgo == state_findingStartOfClimb) {
        if (trackData.TrackPoints[pos].elevation > refElevation) {
          // we are climbing -> let's now find the end of this climb
          stateAlgo = state_findingEndOfClimb;
          climbStartPos = pos - 1;
        }
        else if (trackData.TrackPoints[pos].elevation < refElevation) {
          // we are not climbing, keep searching
        }
        refElevation = trackData.TrackPoints[pos].elevation;
      }
      else if (stateAlgo == state_findingEndOfClimb) {
        if (trackData.TrackPoints[pos].elevation > refElevation) {
          refElevation = trackData.TrackPoints[pos].elevation;
          climbEndPos = pos;
        }
        if (trackData.TrackPoints[pos].elevation < (refElevation - minClimbElevation)) {
          // back in a descent; did we find a climb?
          if ( (trackData.TrackPoints[pos].elevation - trackData.TrackPoints[climbStartPos].elevation) > minClimbElevation ) {
            // we need at least 10m of elevation difference to qualify it as a 'climb'
            var climb = {};
            climb.index = allClimbs.length;
            climb.startPos = climbStartPos;
            climb.endPos = climbEndPos;
            // 2019.12.17 cleanup after check ok
            climb.minElevation = trackData.TrackPoints[climbStartPos].elevation;
            climb.maxElevation = trackData.TrackPoints[climbEndPos].elevation;
            climb.minDistance = trackData.TrackPoints[climbStartPos].totalDistance;
            climb.maxDistance = trackData.TrackPoints[climbEndPos].totalDistance;
            // climb.maxElevation = refElevation;
            allClimbs.push(climb);
          }
          else {
            // startPos is just a hump in the road; let's restart the search for a climb
          }
          stateAlgo = state_findingStartOfClimb; // start finding next climb
          refElevation = trackData.TrackPoints[pos].elevation;
        }
      }
    }
    // did we leave the loop in the middle of a climb -> let's count it in
    if ((stateAlgo == state_findingEndOfClimb) && ((trackData.TrackPoints[climbEndPos].elevation - trackData.TrackPoints[climbStartPos].elevation) > minClimbElevation)) {
      var climb = {};
      climb.index = allClimbs.length;
      climb.startPos = climbStartPos;
      climb.endPos = climbEndPos;
      // 2019.12.17 cleanup after check ok - TODO cleanup duplicate code!
      climb.minElevation = trackData.TrackPoints[climbStartPos].elevation;
      climb.maxElevation = trackData.TrackPoints[climbEndPos].elevation;
      climb.minDistance = trackData.TrackPoints[climbStartPos].totalDistance;
      climb.maxDistance = trackData.TrackPoints[climbEndPos].totalDistance;
      // climb.maxElevation = refElevation;
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

// toont de data van riders & ghosts (graphics overlay)
// stuurt de trainer aan
// stuurt de video aan
class Simulator {
  constructor() {
    this.state = SIMULATION_IDLE;
    this.secUpdateTimer = null;
    this.rider = undefined;

    // the simulator is launched after onBodyLoad
    this.video = document.getElementById("myVideo");
    this.video.playbackRate = 0.0; // de playback rate wordt door de secondUpdate bijgestuurd
    this.video.pause();

    // html page info
    this.debugTxt = document.getElementById("debugTxt");
    this.canvasGradient = document.getElementById("canvasGradient");
    this.ctx = this.canvasGradient.getContext("2d");

  } // constructor

  addRider (rider) {
    this.rider = rider;
  } // addRider

  // TODO : check if a track connected to the simulator is needed
  addTrack (track) {
    this.track = track;
    if (this.rider) {
      this.rider.addTrack(track);
    }
    this.state = SIMULATION_READY;
  } // addTrack

  addGhost (ghost) {
    this.ghost = ghost;
  } // addGhost

  // load the video file in the this.video element
  loadVideo(videoFile) {
    this.video.setAttribute("src",URL.createObjectURL(videoFile));
   
    this.video.load();
    this.video.playbackRate = 0.0; // de playback rate wordt door de secondUpdate bijgestuurd
    this.video.loop = false;
    this.video.pause();
  } // loadVideo

  // return true = OK, false = NOK
  // TODO : should we implement rider.start() to control the trainer?
  async start () {
    let retvalOK = false;

    if ((this.state == SIMULATION_READY) || (this.state == SIMULATION_PAUSED)) {
      if (this.video.readyState) { // video selected
        this.video.play();
      }
      this.state = SIMULATION_RUNNING;
      if (this.rider.trainer.connected) {
        await this.rider.trainer.start().catch(()=>{
          return retvalOK;
        });
      }
      // start the secUpdate interval
      this.secUpdateTimer = setInterval(() => {
        this.secUpdate();
      }, 1000);
      retvalOK = true;
    }
    return retvalOK;
  } // start

  // return true = OK, false = NOK
  async pause () {
    let retvalOK = false;

    if (this.state == SIMULATION_RUNNING) {
      if (this.video.readyState) {
        this.video.pause();
      }
      this.state = SIMULATION_PAUSED;
      if (this.rider.trainer.connected) {
        await this.rider.trainer.pause().catch(()=>{
          return retvalOK;
        });
      }
      clearInterval(this.secUpdateTimer);
      retvalOK = true;
    }
    return retvalOK;
  } // pause

  secUpdate () {
    let trackInfo;
    let curTrackPointData;
    let curVideoPointData;

    // call rider.secUpdate & ghost.secUpdate
    if (this.rider) this.rider.secUpdate();
    if (this.ghost) this.ghost.secUpdate();

    // if eof -> stop the trainer
    // reset the trainer resistance? -> done by trainer during pause
    // TODO : this.rider.trainer.pause().catch(()=>{});

    let r = this.rider.state; // abbreviation
    if (this.track) {
      curTrackPointData = this.track.getCurTrackPointData(r.curDistance);
      trackInfo = this.track.getTrackInfo(); // TODO : eigenlijk hoeft dit maar 1 keer, of elke keer als de track wijzigt

      if (curTrackPointData.eof) {
        // pause the simulation
        this.pause();
        return;
      }

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

      // set resistance on trainer based on curTrackPointData.gradient
      // formula experimental for Elite Direto
      let newResistanceLevel = Math.round (Math.min(1610*curTrackPointData.gradient + 22,200));
      // direto won't set resistance to 0
      newResistanceLevel = Math.max (newResistanceLevel, 1); 
      // we will tolerate a difference of 1 resistance unit before resending the command
      // anyway it might take several seconds for big changes in resistance to take effect
      // || 0 is needed, because the trainer doesn't report resistanceLevel if it has never been set before
      let trainerResistanceLevel = this.rider.trainer.bikeData.resistanceLevel || 0;
      if (Math.abs(trainerResistanceLevel - newResistanceLevel) > 1){
        // dongleCmdChangeResistance (resistance);
        this.rider.trainer.setResistance(newResistanceLevel).catch(()=>{});
      }
  
    } // active track

    // update html page
    let avgSpeed = r.curSpeed, avgCadence = r.curCadence, avgPower = r.curPower;
    let avgPedalPowerBalance=r.curPedalPowerBalance;
    if (r.totalTime) {
      avgSpeed = (r.totalSpeed*3.6/r.totalTime);
      avgPower = (r.totalPower/r.totalTime);
      avgCadence = (r.totalCadence/r.totalTime);
      avgPedalPowerBalance = (r.totalPedalPowerBalance/r.totalPower)*100.0;
    }
    this.debugTxt.innerHTML = `${(r.curSpeed*3.6).toFixed(2)} km/h (avg: ${avgSpeed.toFixed(1)} km/h)`;
    this.debugTxt.innerHTML += ` &#x2726; ${r.curPower}W (avg: ${avgPower.toFixed(0)}W)`;
    this.debugTxt.innerHTML += ` &#x2726; ${r.curCadence}rpm (avg:${avgCadence.toFixed(0)}rpm)`;
    this.debugTxt.innerHTML += ` &#x2726; ${(100-r.curPedalPowerBalance)}/${r.curPedalPowerBalance} (avg:${(100-avgPedalPowerBalance).toFixed(0)}/${avgPedalPowerBalance.toFixed(0)})`

    if (this.rider.track) {
      this.debugTxt.innerHTML += "<br>";
      this.debugTxt.innerHTML += `${r.curDistance.toFixed(0)}m`; // geen cijfers na de komma
      this.debugTxt.innerHTML += `(&rarr;${(trackInfo.totalDistance - r.curDistance).toFixed(0)}m)`; 
      this.debugTxt.innerHTML += ` &#x2726; ${sec2string(r.totalTime)}`;
      this.debugTxt.innerHTML += ` &#x2726; alt: ${r.curElevation.toFixed(0)}m @ ${(curTrackPointData.gradient*100.0).toFixed(1)}%`;
      //this.debugTxt.innerHTML += " resistance = " + this.rider.trainer.bikeData.resistanceLevel;
      this.debugTxt.innerHTML += ` &#x2726; ${r.totalAscent.toFixed(0)}m &uarr; (&rarr; ${trackInfo.totalAscent.toFixed(0)}m)`;
      this.debugTxt.innerHTML += ` &#x2726; ${r.totalDescent.toFixed(0)}m &darr;`;
      this.debugTxt.innerHTML += "<br>";

      // show climbs
      // curTrackPointData.climb
      if (curTrackPointData.climb.onClimb) {
        let curClimb = curTrackPointData.climb.curClimb;
        let climbDistanceLeft = curClimb.maxDistance - r.curDistance;
        let climbElevationLeft = curClimb.maxElevation - r.curElevation;
        this.debugTxt.innerHTML += `this climb (${curClimb.index+1}/${trackInfo.numClimbs}): ${climbDistanceLeft.toFixed(0)} m @ ${(100*climbElevationLeft / climbDistanceLeft).toFixed(1)}% to go`;
      }
      else {
        let nextClimb = curTrackPointData.climb.nextClimb;
        if (nextClimb) {
          let distFromClimb = nextClimb.minDistance - r.curDistance;
          let climbElevation = nextClimb.maxElevation - nextClimb.minElevation;
          let climbDistance = nextClimb.maxDistance - nextClimb.minDistance;
          this.debugTxt.innerHTML += `next climb (${nextClimb.index+1}/${trackInfo.numClimbs}) in ${distFromClimb.toFixed(0)}m, ${climbDistance.toFixed(0)}m @ ${(100*climbElevation / climbDistance).toFixed(1)}%`;
        }
      }

      // show avg gradient over next km
      this.debugTxt.innerHTML += ` next km @ ${(100*curTrackPointData.avgGradient).toFixed(2)}%`
    
    } // data shown when track active

    // TODO : show ghost data
    if (this.ghost) {
      this.debugTxt.innerHTML += "<br>";
      let curPos = {};
      curPos.totalDistance = this.rider.state.curDistance;
      curPos.elapsedTime = this.rider.state.totalTime;
      let ghostPos = this.ghost.compareGhost(curPos);
      let ghostTimeDiff = ghostPos.elapsedTime - curPos.elapsedTime;
      let ghostDistDiff = ghostPos.totalDistance - curPos.totalDistance;
      if ((ghostTimeDiff < 0) || (ghostDistDiff > 0))  {
        this.debugTxt.innerHTML += `ghost is ahead by ${sec2string((-ghostTimeDiff).toFixed(1))}, ${ghostDistDiff.toFixed(0)}m`;
      }
      else {
        this.debugTxt.innerHTML += `ghost is behind by ${sec2string(ghostTimeDiff.toFixed(1))}, ${(-ghostDistDiff).toFixed(0)}m`;
      }
    }

  } // secUpdate

  // draws a section of the gradient canvas with gradient (color); the section runs from startPercent (0..1) to endPercent (0..1) 
  _drawGradient (gradient, startPercent, endPercent) {
    // height 15 versie
    var yMin = 0, yMax = 0;
    const canvasHeight = 15;
    if (gradient > 0) {
      // filling the upper part of the canvas section
      yMax = 10;
      yMin = Math.max(Math.floor(11-gradient*100),0);
    }
    else if (gradient < 0) {
      // filling the lower part of the canvas section
      yMin = 10;
      if (gradient > -0.01) yMax = 11;
      if (gradient > -0.02) yMax = 12;
      if (gradient > -0.05) yMax = 13;
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
    else color = "#941b1d"; // red #FF0000 // 941b1d : kinomap red
    
    // do the filling
    // empty the section first
    //ctx.fillStyle = "#000000";
    this.ctx.clearRect(xMin,0, xMax-xMin,canvasHeight);

    this.ctx.fillStyle = color;
    this.ctx.fillRect(xMin,yMin, xMax-xMin,yMax-yMin);
    
  } // _drawGradient  

} // Simulator

class Rider {
  constructor(riderWeight = 83.0) {
    this.state = {
      // don't keep data here that are linked to the Track object
      curPower : 0,
      curCadence : 0,
      curPedalPowerBalance : 0,
      curSpeed : 0.0,
      curDistance : 0.0,
      curElevation : -1000.0, // used to keep track of totalAscent / totalDescent; negative default value to trigger init
      totalTime : 0, // seconds
      totalPower : 0, // watts
      totalCadence : 0, // rpm
      totalPedalPowerBalance : 0, // %
      totalSpeed : 0.0, // km/h
      totalAscent : 0.0, // m
      totalDescent : 0.0, // m
    };
    this.track = null; // CHECK : is dit nodig voor init? (de simulator wil checken of er een track geassocieerd is)
    this.rideLog = [];
    this.trainer = window.direto; // this.trainer.bikeData has the latest data reported by the trainer
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

  // track is a Track class object
  addTrack(track) {
    this.track = track;
    // the trackData are not available yet, will be populated only after the reader returns!
    // this doesn't work : 
    //this.state.curElevation = this.track.trackData.TrackPoints[0].elevation; // rider starts at initial elevation
  } // addTrack

  // connect the direto and subscribe the bike data
  // caller try-catches errors
  async connect() {
    if (!this.trainer.connected) {
      await this.trainer.connect();
      log("connect done");
      await this.trainer.init();
      log("init done");
      // 2019.12.18 - won't use a listener, the bikeData are available on the trainer
      //this.trainer.addEventListener('onbikedata', this._onBikeData.bind(this));
    }
  } // connect

  // disconnect the direto -unsubscribe is automatic
  // caller try-catches errors
  async disconnect () {
    if (this.trainer.connected) {
      //await direto.stop(); // ofwel failt als je al gepaused of gestopped bent
      // en dan gaat de disconnect() hierna ook niet door
      await this.trainer.disconnect();
    }
  } // disconnect

  // function is called every second
  secUpdate() {
    if (this.trainer.connected) {
      if (this.trainer.bikeData.instantaneousPower != undefined) {
        this.state.curPower = this.trainer.bikeData.instantaneousPower;
        this.state.curCadence = this.trainer.bikeData.instantaneousCadence;
        // curPedalPowerBalance is systematically right side, if used with a cadence sensor
        // linked to the trainer. Without this feedback signal, left/right is a little random
        this.state.curPedalPowerBalance = this.trainer.bikeData.pedalPowerBalance;
      } else { 
        this.state.curPower = 0;
      }
    } else {
      this.state.curPower = this.simPower; // use simulation power data
    }

    if (this.track) {
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
  
      // TODO : better way to init the elevation
      if (this.state.curElevation < -999.9) {
        this.state.curElevation = this.track.trackData.TrackPoints[0].elevation; 
      }
  
      // keep track of total ascent / descent
      if (curInfo.elevation > this.state.curElevation) {
        this.state.totalAscent += (curInfo.elevation - this.state.curElevation);
      } else if (curInfo.elevation < this.state.curElevation) {
        this.state.totalDescent += (this.state.curElevation - curInfo.elevation);
      }
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
      this.rideLog.push(point);
  
      if (curInfo.eof) {
        // TODO : we should stop logging at some point because we reached the end of the track!!
      }
      
      // update speed according to bike riding model
      let bikeModelData = {
        gradient : curInfo.gradient,
        speed : this.state.curSpeed,
        power : this.state.curPower,
      };
      this.state.curSpeed = this._runBikeModel(bikeModelData); // next 1 second we will be riding at curSpeed
    }
  } // secUpdate

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

  // curPos.totalDistance, curPos.elapsedTime
  compareGhost (curPos) {
    let ghostElapsedTime = curPos.elapsedTime; // any init
    let ghostTotalDistance = 0;

    // for the moment only using the timing & totalDistance imported on the VideoPoints array
    // TODO : lees bv. ook power/cadence data uit de ghost gpx
    let TimingPoints = this.track.trackData.VideoPoints;
    let ghostPos = 0;
    
    // when did the ghost pass at curPos.totalDistance?
    while ((TimingPoints[ghostPos].totalDistance < curPos.totalDistance) && (ghostPos < (TimingPoints.length - 1)))
      ghostPos ++;
    ghostElapsedTime = TimingPoints[ghostPos].videoTime; // ghostElapsedTime - curPos.elapsedTime = voorsprong van de ghost (negatief seconden)
    
    // where did the ghost pass at curPos.elapsedTime?
    ghostPos = 0;
    while ((TimingPoints[ghostPos].videoTime < curPos.elapsedTime) && (ghostPos < (TimingPoints.length - 1)))
      ghostPos ++;
    ghostTotalDistance = TimingPoints[ghostPos].totalDistance; // ghostTotalDistance - curPos.totalDistance = voorsprong van de ghost (positief meters)

    return {elapsedTime : ghostElapsedTime, totalDistance : ghostTotalDistance };
  
  } // compareGhost

  secUpdate () {
    // TODO, voorlopig niet nodig
  }
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