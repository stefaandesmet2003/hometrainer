'use strict';
/*
TODO : the recorded file ghost can't handle jumps in curDistance from the UI
because it takes its curDistance from the totalTime lookup in the gpx log 
possibility : find position in log that corresponds with the new curDistance and adjust the ghost's totalTime 
*/
class Ghost extends Rider {
  constructor (simPower=100) {
    let settings = getStoredSettings();
    super(settings.riderWeight);
    this.simulatedPowerMode = true;
    super.setSimPower(simPower);
  } // constructor

  start() {
    console.log(`ghost.start, simulatedPowerMode= ${this.simulatedPowerMode}`);
    super.start();
  } // start

  pause() {
    console.log("ghost.pause");
    super.pause();
  } // pause  

  secUpdate() {
    if (this.simulatedPowerMode) super.secUpdate();
    else { // a modified version of the rider, using the logged data
      if (this.isRiding) {
        this.state.totalTime++;
        this.state.curDistance = this.track.trackData.TrackPoints[this.state.totalTime].totalDistance;
        this.state.curPower = this.track.trackData.TrackPoints[this.state.totalTime].power;
        // in order to show the current speed we have to run the bikemodel
        let curInfo = this.track.getCurTrackPointData(this.state.curDistance);
        let bikeModelData = {
          gradient : curInfo.gradient,
          speed : this.state.curSpeed,
          power : this.state.curPower,
        };
        this.state.curSpeed = this._runBikeModel(bikeModelData); // next 1 second we will be riding at curSpeed        
        // update rideLog, only need curDistance for now (to compare position with real rider)
        let point =  {};
        point.curDistance = this.state.curDistance; // 11.2023, for the ghost tracking
        this.rideLog.push(point);
        //console.log(`${this.state.totalTime}:v=${(this.state.curSpeed*3.6).toFixed(2)},d=${this.state.curDistance},p=${this.state.curPower}`)
      }
    }
  } // secUpdate

  setTrack(track) {
    super.setTrack(track);
    if (track.trackData.TrackPoints[0].hasOwnProperty("power")) {
      // loading a recorded effort, leaving simulated power mode
      this.simulatedPowerMode = false;
      log(`ghost.setTrack : using recorded ghost : ${track._file.name} date ${new Date(track._file.lastModified).toDateString()}`)
    }
    else {
      // keep running in simulated power mode
      console.log(`ghost.setTrack : = ${this.simPower}W simulated power ghost`);
    }
    
  } // setTrack

} // Ghost

