'use strict';
/*
oude ghost : 
een ghost is een track met TrackPoints[] en VideoPoints[]
de track.TrackPoints[idx].totalDistance is de afgelegde weg op idx
track.TrackPoints[idx].power : recording van de power
de track.VideoPoints[idx].videoTime geeft dan het tijdstip dat de ghost op dit punt was
-> compareGhost
*/

class Ghost {
  constructor (track, isSim=false, simPower = 100) {
    this.isSim = isSim;
    if (isSim) {
      let settings = getStoredSettings();
      this.rider = new Rider(settings.riderWeight);
      this.rider.setTrack(track);
      this.rider.setSimPower(simPower);
    }
    else {
      this.track = track;
    }
  } // constructor

  // {curPos.totalDistance, curPos.elapsedTime}
  // voor een track = eerdere opname
  // TODO : retval.curSpeed : waarom moet dat in km/h en niet in m/s zoals in de rider?
  compareGhost (curPos) {
    let retval = {};
    if (this.isSim) {
      // retrieve data from the ghost rider
      retval.curPower = this.rider.simPower;
      retval.totalDistance = this.rider.state.curDistance;
      retval.curSpeed = 3.6 * this.rider.state.curSpeed;
      retval.elapsedTime = this.rider.state.totalTime;
    }
    else {
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
    }
    return retval;
  } // compareGhost

  start() {
    if (this.isSim) this.rider.start();
  } // start

  pause() {
    if (this.isSim) this.rider.pause();
  } // pause  

  // voor een power ghost met een dead track
  secUpdate() {
    if (this.isSim) this.rider.secUpdate();
  } // secUpdate

} // Ghost

