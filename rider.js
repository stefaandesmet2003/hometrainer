'use strict';
class Rider {
  constructor(riderWeight = 83.0) {
    this._init();
    //this.trainer = window.direto; // this.trainer.bikeData has the latest data reported by the trainer
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
    this.trainerDifficulty = 100.0;
  } // constructor

  setRiderWeight(riderWeight) {
    this.bikeModelParams.riderWeight = riderWeight;
  }

  // 11.2023 a rider without trainer is a simpower ghost
  setTrainer () {
    this.trainer = window.direto; // this.trainer.bikeData has the latest data reported by the trainer
  } // setTrainer

  setSimPower(power) {
    this.simPower = power;
  } // setSimPower

  // influences how much the resistance changes with gradients
  setTrainerDifficulty(trainerDifficulty) {
    this.trainerDifficulty = trainerDifficulty;
    this.trainerDifficulty = Math.max(Math.min(this.trainerDifficulty,100.0),0.0); // just to be sure to filter potential junk from UI
  } // setTrainerDifficulty


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
    if (this.trainer && !this.trainer.connected) {
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
    if (this.trainer && this.trainer.connected) {
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
    if (this.trainer && this.trainer.connected) {
      await this.trainer.start().catch(()=>{});
    }
  } // start

  async pause() {
    if (this.isRiding && this.trainer && this.trainer.connected) {
      await this.trainer.pause().catch(()=>{});
    }
    this.isRiding = false;
  } // pause

  // compare this rider with rider2
  // returns {timeDifference, distanceDifference}, positive when this rider is ahead
  compare (rider2) {
    let retval = {};
      retval.distanceDifference = this.state.curDistance - rider2.state.curDistance;
      if (this.rideLog.length == 0) { // not started
        retval.timeDifference = 0; 
        return retval;
      }

      // this rider ahead
      if (this.state.curDistance > rider2.state.curDistance) {
        // time difference (>0) is time when this rider passed the rider2.state.curDistance
        // find in this rider's rideLog
        let pos = 0;
        while (this.rideLog[pos].curDistance <  rider2.state.curDistance)
          pos++;
        retval.timeDifference = this.state.totalTime - pos;
      }
      else { // rider2 is ahead
        // time difference(<0) is time when rider2 passed this rider's curDistance
        // find in rider2's rideLog
        let pos = 0;
        while (rider2.rideLog[pos].curDistance <  this.state.curDistance)
          pos++;
        retval.timeDifference = pos - this.state.totalTime;
      }
    return retval;
  } // compare

  // function is called every second
  async secUpdate() {
    if (this.trainer && this.trainer.connected) {
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
      point.curDistance = this.state.curDistance; // 11.2023, for the ghost tracking
      this.rideLog.push(point);

      if (this.trainer) {
        // update bike resistance based on current gradient (curInfo.gradient)
        // experimental formula for Elite Direto based on my 80kg -> TODO adapt following rider weight
        // 04/2023 : update with trainerDifficulty, for now will simply adjust the slope of resistance level adjusts
        let newResistanceLevel = Math.round (Math.min(1610*curInfo.gradient*(this.trainerDifficulty/100.0) + 22,200));
        // direto won't set resistance to 0
        newResistanceLevel = Math.max (newResistanceLevel, 1); 
        // we will tolerate a difference of 1 resistance unit before resending the command
        // anyway it might take several seconds for big changes in resistance to take effect
        // || 0 is needed, because the trainer doesn't report resistanceLevel if it has never been set before
        let trainerResistanceLevel = this.trainer.bikeData.resistanceLevel || 0;
        if (Math.abs(trainerResistanceLevel - newResistanceLevel) > 1) {
          this.trainer.setResistance(newResistanceLevel).catch(()=>{});
        }
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
    // ETA : run the bike model until the end of the track using current power
    if (this.state.curPower == 0 && this.state.curSpeed < 0.01) {
      this.state.eta = 0;
    }
    else {
      let etaSeconds = 0;
      let etaSpeed = this.state.curSpeed;
      let etaDistance = this.state.curDistance;
      let etaPower = this.state.curPower;
      let etabikeModelData = {};
      let etaEof = false;
      while (!etaEof && etaSeconds < 5400) { // run the bikemodel to the end of the track or max 1,5h
        etaSeconds+= 1;
        etaDistance += etaSpeed*1.0;
        let etaCurInfo = this.track.getCurTrackPointData(etaDistance);
        etaEof = etaCurInfo.eof;
        etabikeModelData.gradient = etaCurInfo.gradient;
        etabikeModelData.speed = etaSpeed;
        etabikeModelData.power = etaPower;
        etaSpeed = this._runBikeModel(etabikeModelData); // next 1 second we will be riding at curSpeed
      }
      this.state.eta = etaSeconds;
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
      eta : 0, // seconds
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
