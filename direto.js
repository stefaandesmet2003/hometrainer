(function() {
  'use strict';
  // ftms commands
  const FTMS_CMD_REQUEST_CONTROL = 0;
  const FTMS_CMD_RESET = 1;
  const FTMS_CMD_SET_RESISTANCE = 4;
  const FTMS_CMD_START_RESUME = 7;
  const FTMS_CMD_STOP_PAUSE = 8;
  const FTMS_CMD_PARAM_STOP = 1;
  const FTMS_CMD_PARAM_PAUSE = 2;
  // ftms response codes
  const FTMS_RESP_ERROR = -1;
  const FTMS_RESP_SUCCESS = 1;
  const FTMS_RESP_INVALID_PARAMETER = 3;
  const FTMS_RESP_FAILED = 4;
  const FTMS_RESP_CONTROL_NOT_PERMITTED = 5;

  var replyPromiseResolveFunc = null; // for test (are we missing replies because we are too late registering event listeners?)
  var replyPromiseTimeoutId;



  class Direto {
    constructor() {
      this.device = null;
      this.server = null;
      this._characteristics = new Map();
      this._eventListener = null;
      this._bikeData = {};
      this.connected = false;
    }

    async connect() {
      // met deze lijn krijg je nooit toegang tot de 0x1818 en 0x1816 services
      //return navigator.bluetooth.requestDevice({filters:[{services:['fitness_machine']}]})
      /* met deze lijn niet duidelijk : na de lijn eronder met optional services komen deze
         services wel terug, maar geeft geen toegang tot alle primary services die nrf connect vindt
      */         
      //return navigator.bluetooth.requestDevice({acceptAllDevices:true})
      return navigator.bluetooth.requestDevice({
        filters:[{services:['fitness_machine']}],
        optionalServices: [0x180A,0x1818,0x1816]
      })
      .then(device => {
        this.device = device;
        device.addEventListener('gattserverdisconnected', this._onDisconnected);
        return device.gatt.connect();
      })
      .then (server => {
        log("connect: gatt server connected!");
        this.server = server;
        this.connected = true;
        return server.getPrimaryService('fitness_machine');
      })
      .then (service => {
        log("connect : found ftms service!");
        return Promise.all ([
          this._cacheCharacteristic(service, 'fitness_machine_feature'),
          this._cacheCharacteristic(service, 'indoor_bike_data'),
          this._cacheCharacteristic(service, 'training_status'),
          this._cacheCharacteristic(service, 'supported_resistance_level_range'),
          this._cacheCharacteristic(service, 'supported_power_range'),
          this._cacheCharacteristic(service, 'fitness_machine_status'),
          this._cacheCharacteristic(service, 'fitness_machine_control_point'),
        ]);
      })
      // alternative : getCharacteristics() returns all characteristics in an array
      // but then need to match uuid & feature for the map
      /*
      .then (service => {
        return service.getCharacteristics();
      })
      .then(allchars => {
        for (var i=0; i < allchars.length; i++) {
          log(allchars[i].uuid);
        }

      });
      */
     
      .then(() => {
        return this.server.getPrimaryService('cycling_power') // 0x1818
      })
      .then(service => {
        log("connect : found cycling power service!");
        return Promise.all ([
          this._cacheCharacteristic(service, 'cycling_power_feature'),
          this._cacheCharacteristic(service, 'cycling_power_measurement'),
        ]);
      })
      // come here in case a .then above fails
      .catch(()=> {
        log("connect : BLE error!");
        return(Error("connect : BLE error"));
      })   
    } // connect

    _onDisconnected(event) {
      // todo : 'this' != direto in this callback!!
      // issue : this event doesn't fire when the direto is switched off ?!
      log("onDisconnected");
      direto.server = null;
      direto.device = null;
      direto.connected = false;
      //delete direto._characteristics; // or can we assume that the garbage collector cleans up the Map object?

      direto._characteristics = new Map();
      direto._eventListener = null;

    } // _onDisconnected

    async disconnect() {
      if (this.server) {
        this._stopNotifications().then(()=> {
          log("disconnect : OK!");
          return this.server.disconnect();
        // this will trigger _onDisconnected
        },()=> {
          log("disconnect : error stopping notifications");
          return (Error("disconnect : error stopping notifications"));
        })
      }
      else {
        log("disconnect : internal error");
        return 0;
      }
    } // disconnect

    // install callback for bikeData
    addEventListener(type, callbackFunction) {
      // don't care about the type;
      type = 'onbikedata';
      this._eventListener = callbackFunction;
    } // addEventListener

    async init() {
      let respCode = FTMS_RESP_SUCCESS;
      /* something strange here :
        after a disconnect with notifications left on, _startNotifications() reactivates the notifications and
        installs the eventlisteners, but the notifications don't arrive
        maybe web bluetooth caches the request, because it assumes direto still has the notifications on??
        solved by stopping the notifications on disconnect
        default stopping & restarting the notifications here on init produces a strange 'unknown GATT error'
        after a 20 seconds wait for the _startNotifications promises
        maybe these commands need some delay in between ?
      */
      //await this._stopNotifications();
      await this._startNotifications();
      
      respCode = await this._ftmsCommand(FTMS_CMD_REQUEST_CONTROL);
      if (respCode != FTMS_RESP_SUCCESS) {
        return respCode;
      }
      respCode = await this._ftmsCommand(FTMS_CMD_RESET);
      if (respCode != FTMS_RESP_SUCCESS) {
        return respCode;
      }
      respCode = await this._ftmsCommand(FTMS_CMD_REQUEST_CONTROL);
  
      return respCode;
    } // init

    async start() {
      let respCode = FTMS_RESP_SUCCESS;
      // request control is not strictly necessary
      respCode = await this._ftmsCommand(FTMS_CMD_REQUEST_CONTROL);
      if (respCode != FTMS_RESP_SUCCESS) {
        return respCode;
      }
      respCode = await this._ftmsCommand(FTMS_CMD_START_RESUME);
  
      return respCode;

    } // start

    async pause() {
      let respCode = FTMS_RESP_SUCCESS;
      // request control is not strictly necessary
      respCode = await this._ftmsCommand(FTMS_CMD_REQUEST_CONTROL);
      if (respCode == FTMS_RESP_SUCCESS) {
        respCode = await this._ftmsCommand(FTMS_CMD_STOP_PAUSE, FTMS_CMD_PARAM_PAUSE);
      }
      return respCode;
    } // pause

    async stop() {
      let respCode = FTMS_RESP_SUCCESS;
      // request control is not strictly necessary
      respCode = await this._ftmsCommand(FTMS_CMD_REQUEST_CONTROL);
      if (respCode == FTMS_RESP_SUCCESS) {
        respCode = await this._ftmsCommand(FTMS_CMD_STOP_PAUSE, FTMS_CMD_PARAM_STOP);
      }
      
      return respCode;
    } // pause

    async setResistance (resistanceLevel) {
      let respCode = FTMS_RESP_SUCCESS;
      // todo range check
      // setting level = 0 gives INVALID PARAMETER error
      if (resistanceLevel == 0) resistanceLevel = 1;

      // request control is not strictly necessary
      // only if a cmd returns FTMS_RESP_CONTROL_NOT_PERMITTED
      respCode = await this._ftmsCommand(FTMS_CMD_REQUEST_CONTROL);
      if (respCode == FTMS_RESP_SUCCESS) {
        respCode = await this._ftmsCommand(FTMS_CMD_SET_RESISTANCE, resistanceLevel);
      }
      return respCode;
    } // setResistance

    async getFitnessMachineFeatureInfo () {
      try {
        let value = await this._characteristics.get('fitness_machine_feature').readValue();
        // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
        value = value.buffer ? value : new DataView(value);
        let fitnessMachineFeatures = value.getUint32(0, /*littleEndian=*/true);
        let targetSettingFeatures = value.getUint32(4, /*littleEndian=*/true);
        log('Fitness Machine Feature Info :');
        log('> fitnessMachineFeatures: ' + fitnessMachineFeatures.toString(16));
        log('> targetSettingFeatures: ' + targetSettingFeatures.toString(16));
      } catch(error)  {
        log('error reading characteristic : ' + error);
      }

    } // getFitnessMachineFeatureInfo    

    async getSupportedResistanceLevelRange () {
      try {
        let value = await this._characteristics.get('supported_resistance_level_range').readValue();
        // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
        value = value.buffer ? value : new DataView(value);
        let minimumResistanceLevel = value.getInt16(0, /*littleEndian=*/true);
        let maximumResistanceLevel = value.getInt16(2, /*littleEndian=*/true);
        let minimumIncrement = value.getUint16(4, /*littleEndian=*/true);
        //2019.12.07 : waarom die /10 ??
        // vermoedelijk is minimumResistanceLevel == 1, niet 0, want 0 setten lijkt niet te lukken
        log('Supported Resistance Level Range Info :');
        //log('> minimumResistanceLevel: ' + (minimumResistanceLevel / 10));
        //log('> maximumResistanceLevel: ' + (maximumResistanceLevel / 10));
        //log('> minimumIncrement: ' + (minimumIncrement / 10));
        log('> minimumResistanceLevel: ' + minimumResistanceLevel);
        log('> maximumResistanceLevel: ' + maximumResistanceLevel);
        log('> minimumIncrement: ' + minimumIncrement);
      } catch(error)  {
        log('error reading characteristic : ' + error);
      }

    } // getSupportedResistanceLevelRange    

    async getSupportedPowerRange () {
      try {
        let value = await this._characteristics.get('supported_power_range').readValue();
        // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
        value = value.buffer ? value : new DataView(value);
        let minimumPowerLevel = value.getInt16(0, /*littleEndian=*/true);
        let maximumPowerLevel = value.getInt16(2, /*littleEndian=*/true);
        let minimumIncrement = value.getUint16(4, /*littleEndian=*/true);
        log('Supported Resistance Level Range Info :');
        log('> minimumPowerLevel: ' + minimumPowerLevel + 'Watts');
        log('> maximumPowerLevel: ' + maximumPowerLevel + 'Watts');
        log('> minimumIncrement: ' + minimumIncrement + 'Watts');
      } catch(error)  {
        log('error reading characteristic : ' + error);
      }

    } // getSupportedPowerRange

    /*
      returns : 0 : error, != 0 : ftms response code
      1 = SUCCESS, 3 = INVALID PARAMETER, 4 = FAILED, 5 = CONTROL NOT PERMITTED
    */
    
    async _ftmsCommand (cmd, params=0) {
      // voorlopig enkel 0 of 1 param bytes
      let size = 1;
      if (params) {
        size = 2;
      }
      // create an ArrayBuffer with a size in bytes
      var buffer = new ArrayBuffer(size);
      // Create a view
      var view = new Uint8Array(buffer);
      view[0] = cmd;
      if (params) {
        view[1] = params;
      }

      try {
        const ftmscp = this._characteristics.get('fitness_machine_control_point');
        // 1. send command
        log('ftms command : ' + view);
        //let dummy = await ftmscp.writeValue(buffer);
        //2019.12.07 remove await and wait only for the reply
        // from the timings it looks that the reply notification comes very soon after the await
        // if the _onFitnessMachineControlPoint notification is executed before the promise is set up here
        //  the promise will never be resolved, because the replyPromiseResolveFunc is never called!
        // does removing await help? then replyPromise (and replyPromiseResolveFunc ) is setup synchronously
        ftmscp.writeValue(buffer);
        // 2. setup reply promise
        let replyPromise = new Promise((resolve,reject) => {
          /*
          function ftmsReply(event) {
            // todo : add timeout reject
            ftmscp.removeEventListener('characteristicvaluechanged', ftmsReply);
            clearTimeout(idTimer);
            resolve(event);
          }
          ftmscp.addEventListener('characteristicvaluechanged', ftmsReply);
          // set 1s reject timeout on the reply
          let idTimer = setTimeout(() => {
            ftmscp.removeEventListener('characteristicvaluechanged', ftmsReply);
            log("ftms reply timeout!");
            reject(Error("timeout"));

          }, 1000);
          */
         replyPromiseResolveFunc = resolve; // and from here the installed listener will handle the promise
          // set 1s reject timeout on the reply
          replyPromiseTimeoutId = setTimeout(() => {
            replyPromiseResolveFunc = null;
            log("ftms reply timeout!");
            reject(Error("timeout"));

          }, 1000);
        });
        // 3. await reply
        log("await reply..");
        const event = await replyPromise;
        log("received reply!");
        replyPromiseResolveFunc = null;
        let evtData = event.target.value;
        // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
        evtData = evtData.buffer ? evtData : new DataView(evtData);
        // parsing data : TODO
        var view = new Uint8Array(evtData.buffer);
        return (view[2]); /* the ftms cp response code */

      } catch(error)  {
        log('error in ftmsCommand ' + view + ' : ' + error);
        replyPromiseResolveFunc = null;//2019.12.7, is dit nodig, want gebeurt al in de timeout handler??
        return 0;
      }

    } // _ftmsCommand


    async _startNotifications() {

      try {
        let indoorBikeData = this._characteristics.get('indoor_bike_data');
        let fitnessMachineControlPoint = this._characteristics.get('fitness_machine_control_point');
        let fitnessMachineStatus = this._characteristics.get('fitness_machine_status');
        let cyclingPowerMeasurement = this._characteristics.get('cycling_power_measurement');
        await Promise.all([
          indoorBikeData.startNotifications(),
          fitnessMachineControlPoint.startNotifications(),
          fitnessMachineStatus.startNotifications(),
          cyclingPowerMeasurement.startNotifications(),
        ]);
        // todo : find a way to limit the scope of these listeners
        // can't be local to startNotifications, otherwise can't call removeEventListener later
        indoorBikeData.addEventListener('characteristicvaluechanged', this._onIndoorBikeData);
        fitnessMachineStatus.addEventListener('characteristicvaluechanged', this._onFitnessMachineStatus);
        fitnessMachineControlPoint.addEventListener('characteristicvaluechanged', this._onFitnessMachineControlPoint);
        cyclingPowerMeasurement.addEventListener('characteristicvaluechanged', this._onCyclingPowerMeasurement);
        log ("started notifications!");

      } catch(error) {
        log("error starting notifications : " + error);
      }
    } // _startNotifications

    async _stopNotifications() {
      try {
        let indoorBikeData = this._characteristics.get('indoor_bike_data');
        let fitnessMachineControlPoint = this._characteristics.get('fitness_machine_control_point');
        let fitnessMachineStatus = this._characteristics.get('fitness_machine_status');
        let cyclingPowerMeasurement = this._characteristics.get('cycling_power_measurement');
        await Promise.all([
          indoorBikeData.stopNotifications(),
          fitnessMachineControlPoint.stopNotifications(),
          fitnessMachineStatus.stopNotifications(),
          cyclingPowerMeasurement.stopNotifications(),
        ]);
        indoorBikeData.removeEventListener('characteristicvaluechanged', this._onIndoorBikeData);
        fitnessMachineStatus.removeEventListener('characteristicvaluechanged', this._onFitnessMachineStatus);
        fitnessMachineControlPoint.removeEventListener('characteristicvaluechanged', this._onFitnessMachineControlPoint);
        cyclingPowerMeasurement.removeEventListener('characteristicvaluechanged', this._onCyclingPowerMeasurement);
        log("stopped notifications!");

      } catch(error) {
        log("error stopping notifications : " + error);
      }
    } // _stopNotifications

    _onIndoorBikeData (event) {
      var evtData = event.target.value;
      // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
      evtData = evtData.buffer ? evtData : new DataView(evtData);
      /*
      // log raw data
      var view8 = new Uint8Array(evtData.buffer);
      log ("bikeData : " + view8.toString());
      */
      // parse the pData according to the spec
      let flags = evtData.getUint16(0, /* littleEndian */ true);
      let idx = 2;
      // todo : howto access this._bikeData from here?? this = remotegattcharacteristic here!!
      // fix for now : use direto._bikeData
      if ((flags & 0x1) == 0) { // C1 contains instantaneous speed
        // 16-bit field is km/h with 0.01 resolution
        direto._bikeData.instantaneousSpeed = evtData.getUint16(idx, /* littleEndian */ true) / 100.0;
        idx += 2;
      }
      if (flags & 0x2){ // C2 average speed - skip
        idx += 2;
      }
      if (flags & 0x4) { // C3 instantaneous cadence
        // 16-bit field is cadence with 0.5 resolution
        direto._bikeData.instantaneousCadence = evtData.getUint16(idx, /* littleEndian */ true) >> 1;
        idx += 2;
      }
      if (flags & 0x8) { // C4 average cadence -- skip
        idx += 2;
      }
      if (flags & 0x10) { // C5 total distance - 3 bytes
        direto._bikeData.totalDistance = evtData.getUint32(idx, /* littleEndian */ true) & 0xffffff; // 24-bits field
        idx += 3;
      }
      if (flags & 0x20) { // C6 resistance level
        direto._bikeData.resistanceLevel = evtData.getUint16(idx, /* littleEndian */ true);
        idx += 2;
      }
      if (flags & 0x40) { // C7 instantaneous power
        direto._bikeData.instantaneousPower = evtData.getUint16(idx, /* littleEndian */ true);
        idx += 2;
      }
      if (flags & 0x80) { // C8 average power - skip
        idx += 2;
      }
      if (flags & 0x100) { // C9 expended energy - skip
        idx += 5;
      }
      if (flags & 0x200) { // C10 hear rate - skip
        idx += 1;
      }
      if (flags & 0x400) { // C11 metabolic equivalent - skip
        idx += 1;
      }
      if (flags & 0x800) { // C12 elapsed time
        direto._bikeData.elapsedTime = evtData.getUint16(idx, /* littleEndian */ true);
      }

      // call bikeData event listener
      // todo : can't use this here!!
      if (direto._eventListener)
        direto._eventListener(direto._bikeData);
    } // _onIndoorBikeData
    
    // here ftms status changes are reported
    _onFitnessMachineStatus(event) { 
      var evtData = event.target.value;
      // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
      evtData = evtData.buffer ? evtData : new DataView(evtData);
      // parsing data : TODO
      var view8 = new Uint8Array(evtData.buffer);
      log ("ftms status : " + view8.toString());

    } // _onFitnessMachineStatus    

    /* a fixed listener for ftms replies instead of a listener per command
       pro : the listener per command installed after writing the characteristic seemed less stable
       con : need 2 globals to keep track of the promise & the timeout
    */
    _onFitnessMachineControlPoint(event) {
      var evtData = event.target.value;
      // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
      evtData = evtData.buffer ? evtData : new DataView(evtData);
      // parsing data : TODO
      var view8 = new Uint8Array(evtData.buffer);
      log ("direto replies : " + view8.toString());

      // handle the replyPromise here -> works better than installing an event listener on each ftms command
      if (replyPromiseResolveFunc) {
        replyPromiseResolveFunc(event);
        clearTimeout(replyPromiseTimeoutId);
      }
      else {
        log("error in replyPromise, cannot resolve!!"); // 2019.12.07, for debug
      }
    } // _onFitnessMachineStatus
    
    _onCyclingPowerMeasurement(event) {
      var evtData = event.target.value;
      // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
      evtData = evtData.buffer ? evtData : new DataView(evtData);
      /*
      var view8 = new Uint8Array(evtData.buffer);
      log ("cps measurement : " + view8.toString());
      */
      // parse the pData according to the spec
      let flags = evtData.getUint16(0, /* littleEndian */ true);
      let idx = 2;
      // todo : howto access this._bikeData from here?? this = remotegattcharacteristic here!!
      // fix for now : use direto._bikeData
      direto._bikeData.instantaneousPowerCPM = evtData.getUint16(idx, /* littleEndian */ true);
      idx += 2;
      
      if (flags & 0x1) {
        direto._bikeData.pedalPowerBalance = evtData.getUint8(idx) >> 1; // percentage with resolution 1/2
        idx += 1;
      }  
      if (flags & 0x4) { // accumulated torque - skip
        idx += 2;
      }  
      if (flags & 0x10) { // wheel rev data
        direto._bikeData.cumulativeWheelRevolutions = evtData.getUint32(idx, /* littleEndian */ true);
        idx+= 4;
        direto._bikeData.lastWheelEventTime = evtData.getUint16(idx, /* littleEndian */ true);
        idx += 2;
      }  
      if (flags & 0x20) { // crank rev data
        direto._bikeData.cumulativeCrankRevolutions = evtData.getUint16(idx, /* littleEndian */ true);
        idx+= 2;
        direto._bikeData.lastCrankEventTime = evtData.getUint16(idx, /* littleEndian */ true);
        idx += 2;
      }

      // call bikeData event listener
      // todo : can't use this here!!
      if (direto._eventListener)
        direto._eventListener(direto._bikeData);

    } // _onCyclingPowerMeasurement



    /* Utils */

    _cacheCharacteristic(service, characteristicUuid) {
      return service.getCharacteristic(characteristicUuid)
      .then(characteristic => {
        log(`found characteristic ${characteristic.uuid}`);
        this._characteristics.set(characteristicUuid, characteristic);
      });
    }
  } // direto class

  window.direto = new Direto();

})();
 
