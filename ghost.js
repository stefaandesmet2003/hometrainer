'use strict';
/*
TODO : the recorded file ghost can't handle jumps in curDistance from the UI
because it takes its curDistance from the totalTime lookup in the gpx log 
possibility : find position in log that corresponds with the new curDistance and adjust the ghost's totalTime 
(maar dan klopt de behind/ahead niet meer? misschien wel wat compare gebeurt in de ridelogs ..)
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
        // 01.2024 : adjust totalTime from curDistance (die kan springen in UI)
        if (this.state.curDistance != this.track.trackData.TrackPoints[this.state.totalTime].totalDistance){
          // curDistance changed from UI -> adjust totalTime
          let timeIdx = 0; // start looking from start, because UI can jump forward & backward
          while (timeIdx < this.track.trackData.TrackPoints.length && this.track.trackData.TrackPoints[timeIdx].totalDistance <= this.state.curDistance) {
            timeIdx++;
          }
          this.state.totalTime = timeIdx-1;
        }
        else {
          this.state.totalTime++;
        }
        // end 01.2024
        //01.2024 this.state.totalTime++;
        this.state.curDistance = this.track.trackData.TrackPoints[this.state.totalTime].totalDistance;
        this.state.curPower = this.track.trackData.TrackPoints[this.state.totalTime].power;
        // in order to show the current speed we have to run the bikemodel
        // 01.2024 : ghost speed niet meer in UI, dus dit mag eventueel weg
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

