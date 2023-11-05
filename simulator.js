'use strict';

/*
TODO : 
video.duration vgl met videoPoints.videoTime
auto-start? als track gekozen starten van zodra power!=0 || cadence!=0, 
*/

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
    this.ghostSpeed = document.getElementById("data-ghost-spd");
    this.ghostPower = document.getElementById("data-ghost-pow");
    this.ghostPosition = document.getElementById("data-ghost-pos");

    this.cvsMap.addEventListener('click',this.onClick.bind(this));
    this.cvsMap.addEventListener('wheel',this.onWheel.bind(this));
    this.cvsProfile.addEventListener('click',this.onClick.bind(this));
    this.cvsProfile.addEventListener('wheel',this.onWheel.bind(this));

    // console logging
    this.logVideoPlayback = false;
  } // constructor

  onClick(event) {
    //log(`click on ${event.target.id} @ (${event.offsetX},${event.offsetY})`);
    // translate offsetX to curDistance
    if (event.target.id == "cvsProfile") {
      let curDistance = event.offsetX / this.cvsProfile.width * this.track.totalDistance;
      log(`setting curDistance =  ${curDistance}`);
      this.rider.state.curDistance = curDistance;
      if (this.ghost) {
        this.ghost.state.curDistance = curDistance;
      }
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

  addGhost (ghost) {
    this.ghost = ghost;
    if (this.track) {
      ghost.setTrack(this.track);
    }
  } // addGhost

  setTrack (track) {
    this.track = track;
    if (track.trackData.routeName) console.log(`Route name : ${track.trackData.routeName}`);
    console.log(`Track distance = ${track.trackData.TrackPoints[track.trackData.TrackPoints.length-1].totalDistance.toFixed(2)}km,` +
                ` Video distance = ${track.trackData.VideoPoints[track.trackData.VideoPoints.length-1].totalDistance.toFixed(2)}km`);
    for (let i = 0; i< track.allClimbs.length; i ++) {
      let climbDistance = track.allClimbs[i].maxDistance - track.allClimbs[i].minDistance;
      let climbElevation = track.allClimbs[i].maxElevation - track.allClimbs[i].minElevation;
      console.log(`found summit @  ${track.allClimbs[i].maxElevation}m, ${climbElevation.toFixed(0)}m over ${climbDistance.toFixed(0)}m, avg gradient = ${(100*climbElevation / climbDistance).toFixed(1)} %` );
    }

    if (this.rider) {
      this.rider.setTrack(track);
    }
    if (this.ghost) { // although a ghost will most probably be assigned later and this.ghost will be null at this point
      this.ghost.setTrack(track);
    }
    this._initTrackImage();
    this._initProfileImage();
    this._drawData();
    let curTrackPointData = this.track.getCurTrackPointData(0);
    // show initial location yellow dots
    curTrackPointData.totalDistance = 0;
    this._showPoint(curTrackPointData);
  } // setTrack


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
    if (this.rider) this.rider.start();
    if (this.ghost) this.ghost.start();

    if (!this.isRiding) {
      if (this.video.readyState) { // video selected
        this.video.play();
      }
      this.isRiding = true;
    }
  } // start

  async pause () {
    if (this.isRiding) {
      if (this.rider) this.rider.pause();
      if (this.ghost) this.ghost.pause();
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
    if (this.ghost) this.ghost.secUpdate();

    let r = this.rider.state; // abbreviation
    if (this.track) {
      curTrackPointData = this.track.getCurTrackPointData(r.curDistance);

      if (curTrackPointData.eof) {
        // pause the simulation
        this.pause();
        return;
      }

      this._drawData(); // update data

      // update the gradient canvas
      // gradient canvas represents the gradient for the next 30 seconds or minimum 100m
      let startDistance = r.curDistance;
      let canvasDistance = Math.max(100.0,30.0*r.curSpeed);
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
        // 04.2023 : i want to coast on a downhill, so changing this (r.curSpeed is in m/s!!)
        if ((r.curPower < 1 && r.curSpeed < 2.5) || curVideoPointData.videoSpeed < 0.01) {
          // stop video when not pedalling, but allow coasting on a downhill
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
          
        //this.debugTxt.innerHTML += "delta= " + (this.video.currentTime - curVideoPointData.videoSeconds).toFixed(2) + "s, pbrate= " + playbackRate.toFixed(2);
        if (this.logVideoPlayback && this.isRiding) log("delta= " + (this.video.currentTime - curVideoPointData.videoSeconds).toFixed(2) + "s, pbrate= " + playbackRate.toFixed(2));
  
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
    if (this.track) {
      let t = this.track;
      let curTrackPointData = this.track.getCurTrackPointData(r.curDistance);

      this.dataElapsedTime.innerHTML = `${sec2string(r.totalTime)}`;
      this.dataDistance.innerHTML = `${r.curDistance.toFixed(0)}m`;
      this.dataDistance.innerHTML += ` &rarr; ${(t.totalDistance - r.curDistance).toFixed(0)}m<br>`
      this.dataDistance.innerHTML += `ETA: ${sec2string(r.eta)}`
  
      this.dataGradient.innerHTML = `${(curTrackPointData.gradient*100.0).toFixed(1)}`;
      //this.debugTxt.innerHTML += " resistance = " + this.rider.trainer.bikeData.resistanceLevel;
      this.dataAscentInfo.innerHTML = `&uarr; ${r.totalAscent.toFixed(0)}m &rarr; ${(t.totalAscent - r.totalAscent).toFixed(0)}m`;
      this.dataAscentInfo.innerHTML += ` &darr; ${(t.totalDescent - r.totalDescent).toFixed(0)}m`;

      if (t.trackData.routeName) this.debugTxt.innerHTML += t.trackData.routeName;

      // show climbs
      // curTrackPointData.climb
      if (curTrackPointData.climb.onClimb) {
        let curClimb = curTrackPointData.climb.curClimb;
        let climbDistanceLeft = curClimb.maxDistance - r.curDistance;
        let climbElevationLeft = curClimb.maxElevation - r.curElevation;
        this.dataClimbInfo.innerHTML = `(${curClimb.index+1}/${t.numClimbs}) ${climbDistanceLeft.toFixed(0)} m @ ${(100*climbElevationLeft / climbDistanceLeft).toFixed(1)}%`;
      }
      else {
        let nextClimb = curTrackPointData.climb.nextClimb;
        if (nextClimb) {
          let distFromClimb = nextClimb.minDistance - r.curDistance;
          let climbElevation = nextClimb.maxElevation - nextClimb.minElevation;
          let climbDistance = nextClimb.maxDistance - nextClimb.minDistance;
          this.dataClimbInfo.innerHTML = `(${nextClimb.index+1}/${t.numClimbs}) ${climbDistance.toFixed(0)}m @ ${(100*climbElevation / climbDistance).toFixed(1)}%`;
          this.dataClimbInfo.innerHTML += "<br>";
          this.dataClimbInfo.innerHTML += `in ${distFromClimb.toFixed(0)}m`;
        }
      }
      // show avg gradient over next km
      this.dataAvgGradient.innerHTML = `1km @ ${(100*curTrackPointData.avgGradient).toFixed(1)}%`;
    } // data shown when track active

    // show ghost data
    if (this.ghost) {
      let g = this.ghost.state;
      let diff = this.rider.compare(this.ghost);
      this.ghostSpeed.innerHTML = `${(g.curSpeed*3.6).toFixed(2)}`;
      this.ghostPower.innerHTML = `${g.curPower}`;
      if (this.isRiding) {
        if (diff.timeDifference < 0 || diff.distanceDifference < 0) {
          this.ghostPosition.innerHTML = `ahead by ${sec2string((-diff.timeDifference).toFixed(1))}, ${(-diff.distanceDifference).toFixed(0)}m`;
        }
        else {
          this.ghostPosition.innerHTML = `behind by ${sec2string(diff.timeDifference.toFixed(1))}, ${diff.distanceDifference.toFixed(0)}m`;
        }
      }
      else {
        if (this.ghost.simulatedPowerMode) {
          this.ghostPosition.innerHTML = `ghost ${this.ghost.simPower}W`;
        }
        else {
          this.ghostPosition.innerHTML = `recorded ghost ${this.ghost.track._file.name} date ${new Date(this.ghost.track._file.lastModified).toDateString()}`;
        }
      }
    } // ghost
  } // _drawData

  _gradient2Rgb (gradient) {
    let gradientPct = gradient*100.0;
    let rgb = [];
    if (gradientPct < 0.0) {
      let g = Math.max(Math.floor(255+gradientPct*25.5),0);
      rgb = [0,g,255];
    }
    else if (gradientPct < 2.0) {
      let b = Math.max(Math.floor(255-gradientPct*127.5),0);
      rgb = [0,255,b];
    }
    else if (gradientPct < 5.0) {
      let r = Math.min(Math.floor((gradientPct-2.0)*85.0),255);
      rgb = [r,255,0];
    }
    else if (gradientPct < 10.0) {
      let g = Math.max(Math.floor(255-(gradientPct-5.0)*51.0),0);
      rgb = [255,g,0];
    }
    else { // gradients > 10% and color max at 15%
      let b = Math.min(Math.floor((gradientPct-10.0)*51.0),255);
      rgb = [255,0,b];
    }
    let rgbColor = "rgb(" + rgb.map(function (h) { return Math.floor(h); }).join(",") + ")";
    return rgbColor;    
  } // _gradient2Rgb

  // draws a section of the gradient canvas with gradient (color); the section runs from startPercent (0..1) to endPercent (0..1) 
  // gradients in decimal, not percentage ! (0.02 -> 2%)
  _drawGradient (gradient, startPercent, endPercent) {
    // version 04/2023 : complete height of gradient canvas, smooth color change
    // 0% : cyan (0,255,255) - 2% : green (0,255,0) - 5% : yellow (255,255,0) - 10% : red (255,0,0) - 15%+ : purple (255,0,255)
    // <0% : -10%+ : blue (0,0,255)
    const canvasHeight = 15;
    let rgbColor = this._gradient2Rgb(gradient);

    // length of the fill -> from startPercent to endPercent
    // 500 = length of the total canvas
    let xMin = Math.round(startPercent*500);
    let xMax = Math.round(endPercent*500);
    
    // do the filling - empty the section first
    this.ctxGradient.clearRect(xMin,0, xMax-xMin,canvasHeight);
    this.ctxGradient.fillStyle = rgbColor;
    this.ctxGradient.fillRect(xMin,0, xMax-xMin,canvasHeight);
  } // _drawGradient
  
  _lonlat2map (point) {
    let map = {};
    map.x = 3 + Math.round((this.cvsMap.width-5) * (point.lon - this.MIN.lon) / (this.MAX.lon - this.MIN.lon));
    map.y = this.cvsMap.height - 3 - Math.round((this.cvsMap.height-5) * (point.lat - this.MIN.lat) / (this.MAX.lat - this.MIN.lat));
    return map;
  } // lonlat2map

  _eledist2profile (point) {
    let profile = {};
    profile.x = 3 +Math.round((this.cvsProfile.width - 5)* point.totalDistance / this.PROFILE.totalDistance);
    profile.y = (this.cvsProfile.height - 3) - Math.round((this.cvsProfile.height - 5) * (point.elevation - this.PROFILE.min) / (this.PROFILE.max - this.PROFILE.min));
    return profile;
  } // eledist2profile

    // create the trackImage
    _initTrackImage () {
    this.ctxMap.clearRect(0,0,this.cvsMap.width, this.cvsMap.height); // clear canvas
    let lats = this.track.trackData.TrackPoints.map(x=>x.lat);
    let lons = this.track.trackData.TrackPoints.map(x=>x.lon);
    this.MIN = {lat : Math.min(...lats), lon : Math.min(...lons)};
    this.MAX = {lat : Math.max(...lats), lon : Math.max(...lons)};
    this.ctxMap.beginPath();
    for (let i=0; i < this.track.trackData.TrackPoints.length; i++) {
      let map = this._lonlat2map (this.track.trackData.TrackPoints[i]);
      if (i==0) {
        this.ctxMap.moveTo(map.x, map.y);
      }
      else {
        this.ctxMap.lineTo(map.x, map.y);
      }
    }
    this.ctxMap.stroke();
    this.trackImage = this.ctxMap.getImageData(0, 0, this.cvsMap.width, this.cvsMap.height);
  } // _initTrackImage

  // create the profileImage
  // 11.2023 : replaced white line profile by a filled color profile
  _initProfileImage () {
    let t = this.track.trackData.TrackPoints;
    
    this.ctxProfile.clearRect(0,0,this.cvsProfile.width, this.cvsProfile.height); // clear canvas
    let eles = t.map(x=>x.elevation);
    this.PROFILE = {min : Math.min(...eles), max : Math.max(...eles)};
    this.PROFILE.totalDistance = t[t.length-1].totalDistance;
    let prevprof = {x:0, y: this.cvsProfile.height};
    for (let i=0; i < t.length - 1; i++) {
      let prof = this._eledist2profile (t[i]);
      let gradient = (t[i+1].elevation - t[i].elevation) / (t[i+1].totalDistance - t[i].totalDistance);
      let rgbColor = this._gradient2Rgb(gradient);
      this.ctxProfile.fillStyle = rgbColor;
      this.ctxProfile.beginPath();
      this.ctxProfile.moveTo(prevprof.x, this.cvsProfile.height);
      this.ctxProfile.lineTo(prevprof.x, prevprof.y);
      this.ctxProfile.lineTo(prof.x, prof.y);
      this.ctxProfile.lineTo(prof.x, this.cvsProfile.height);
      this.ctxProfile.closePath();
      this.ctxProfile.fill();
      prevprof = prof;
    }
    this.profileImage = this.ctxProfile.getImageData(0, 0, this.cvsProfile.width, this.cvsProfile.height);
  } // _initProfileImage

  _showPoint (point) {
    this.ctxMap.clearRect(0,0,this.cvsMap.width, this.cvsMap.height);
    this.ctxMap.putImageData(this.trackImage, 0, 0);
    let xy = this._lonlat2map(point);
    this.ctxMap.beginPath();
    this.ctxMap.arc(xy.x,xy.y, 3, 0, 2*Math.PI);
    this.ctxMap.fillStyle = "yellow";
    this.ctxMap.fill();

    this.ctxProfile.clearRect(0,0,this.cvsProfile.width, this.cvsProfile.height);
    this.ctxProfile.putImageData(this.profileImage, 0, 0);
    let prof = this._eledist2profile(point);
    this.ctxProfile.beginPath();
    this.ctxProfile.strokeStyle = "white";
    this.ctxProfile.lineWidth = 2;
    this.ctxProfile.moveTo(prof.x, prof.y-10);
    this.ctxProfile.lineTo(prof.x, this.cvsProfile.height);
    this.ctxProfile.stroke();
  } // _showPoint  

} // Simulator

function log(line) {
  let n = Date.now() & 0xffff;
  console.log (`${n} - ${line}`);
} // log

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