(function() {
  'use strict';
  // ftms commands
  const FTMS_CMD_REQUEST_CONTROL = 0;
  const FTMS_CMD_RESET = 1;
  const FTMS_CMD_SET_RESISTANCE = 4;
  const FTMS_CMD_SET_TARGET_POWER = 5;
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

  class Direto {
    constructor() {
      this.device = null;
      this.connected = false; // setting true only if all necessary services/characteristics are found
      this.bikeData = {};
      this._characteristics = new Map();
      this._eventListenerBikeData = null;
      this._replyPromiseResolveFunc = null;
      this._replyPromiseTimeoutId;
      this.hasCadenceSensor = false;
      this.pedalAnalysisData = {};
      this.pedalAnalysisData.peanut = [];
      this._eventListenerPedalAnalysisData = null;

    }

    // reimplementation with async/await
    // try/catch not required, without it a rejected ble promise will bubble up to the caller anyway
    async connect() {
      try {
        // 1. find BLE device
        // without specifying the optional services here, webble won't give us access to these services later on
        // same issue with navigator.bluetooth.requestDevice({acceptAllDevices:true})
        let device = await navigator.bluetooth.requestDevice({
          filters:[{services:['fitness_machine']}],
          optionalServices: [0x180A,0x1818,0x1816,'347b0001-7635-408b-8918-8ff3949ce592']
        });
        this.device = device;
        this._onDisconnectFunc = this._onDisconnected.bind(this);
        // device.addEventListener('gattserverdisconnected', this._onDisconnected.bind(this));
        device.addEventListener('gattserverdisconnected', this._onDisconnectFunc, {once:true});
        
        // 2. connect to its GATT server
        let server = await device.gatt.connect();
        log("direto.connect: gatt server connected!");

        // 3. Fitness Machine service
        let service = await server.getPrimaryService('fitness_machine');
        log("direto.connect : found ftms service!");

        // 4. Fitness Machine characteristics
        // no idea what Promise.all returns, but don't need the return value
        await Promise.all ([
          this._cacheCharacteristic(service, 'fitness_machine_feature'),
          this._cacheCharacteristic(service, 'indoor_bike_data'),
          this._cacheCharacteristic(service, 'training_status'),
          this._cacheCharacteristic(service, 'supported_resistance_level_range'),
          this._cacheCharacteristic(service, 'supported_power_range'),
          this._cacheCharacteristic(service, 'fitness_machine_status'),
          this._cacheCharacteristic(service, 'fitness_machine_control_point'),
        ]);

        // 5. Cycling Power service
        service = await server.getPrimaryService('cycling_power'); // 0x1818
        log("direto.connect : found cycling power service!");
        // 6. Cycling Power characteristics
        // no idea what Promise.all returns, but don't need the return value
        await Promise.all ([
          this._cacheCharacteristic(service, 'cycling_power_feature'),
          this._cacheCharacteristic(service, 'cycling_power_measurement'),
        ]);

        // 7. Pedal Analysis 
        service = await server.getPrimaryService('347b0001-7635-408b-8918-8ff3949ce592');
        log("direto.connect : found pedal analysis service!");
        // 8. Pedal Analysis characteristics
        // the other characteristics are probably for calibration, not loaded for now
        await Promise.all ([
          //this._cacheCharacteristic(service, '347b0010-7635-408b-8918-8ff3949ce592'),
          //this._cacheCharacteristic(service, '347b0011-7635-408b-8918-8ff3949ce592'),
          //this._cacheCharacteristic(service, '347b0012-7635-408b-8918-8ff3949ce592'),
          //this._cacheCharacteristic(service, '347b0013-7635-408b-8918-8ff3949ce592'),
          //this._cacheCharacteristic(service, '347b0014-7635-408b-8918-8ff3949ce592'),
          this._cacheCharacteristic(service, '347b0015-7635-408b-8918-8ff3949ce592'),
          //this._cacheCharacteristic(service, '347b0016-7635-408b-8918-8ff3949ce592'),
          //this._cacheCharacteristic(service, '347b0017-7635-408b-8918-8ff3949ce592'),
          //this._cacheCharacteristic(service, '347b0018-7635-408b-8918-8ff3949ce592'),
          //this._cacheCharacteristic(service, '347b0019-7635-408b-8918-8ff3949ce592'),
        ]);

        this.connected = true;
      }
      catch (error) {
        // come here if anything above fails
        log(`direto.connect : BLE error : ${error}`);
        // both statements do the same, correct?
        //throw new Error("connect : BLE error");
        return Promise.reject(`direto.connect : BLE error : ${error}`);
      }
    } // connect

    _onDisconnected(event) {
      log("direto._onDisconnected : OK!");
      this.device.removeEventListener('gattserverdisconnected', this._onDisconnectFunc);
      this.connected = false;
      this._characteristics.clear(); // clear all key:value pairs in the map
      this._eventListenerBikeData = null;
      this._eventListenerPedalAnalysisData = null;

    } // _onDisconnected

    // reimplementation with async/await
    // try/catch not required, without it a rejected ble promise will bubble up to the caller anyway
    async disconnect() {
      let server = this.device.gatt;
      if (server.connected) {
        try {
          await this._stopNotifications();
          await server.disconnect();
          // this will trigger _onDisconnected
          log("direto.disconnect : OK!");
        }
        catch(error) {
          log(`direto.disconnect error : ${error}`);
          return Promise.reject(`direto.disconnect error : ${error}`);
        }
      }
      else {
        // internal error or already disconnected
        log("direto.disconnect : already disconnected??");
      }
      // why do we keep receiving double onDisconnected logs after a few connect/disconnects ??
      this.device.removeEventListener('gattserverdisconnected', this._onDisconnectFunc);

      return;
    } // disconnect

    // install callback for bikeData
    addEventListener(type, callbackFunction) {
      // don't care about the type;
      if (type == 'onbikedata') {
        this._eventListenerBikeData = callbackFunction;
      }
      else if (type == 'pedaldata') {
        this._eventListenerPedalAnalysisData = callbackFunction;
      }
    } // addEventListener

    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve,ms));
    }

    async init() {
      if (!this.connected) {
        return Promise.reject("direto.init error : not connected");
      }
      let respCode = FTMS_RESP_SUCCESS;
      /* TODO : something strange here :
        after a disconnect with notifications left on, _startNotifications() reactivates the notifications and
        installs the eventlisteners, but the notifications don't arrive
        maybe web bluetooth caches the request, because it assumes direto still has the notifications on??
        solved by stopping the notifications on disconnect
        default stopping & restarting the notifications here on init produces a strange 'unknown GATT error'
        after a 20 seconds wait for the _startNotifications promises
        maybe these commands need some delay in between ?
      */
      //await this._stopNotifications();
      try {
        await this._startNotifications();
      
        respCode = await this._ftmsCommand(FTMS_CMD_REQUEST_CONTROL);
        if (respCode == FTMS_RESP_SUCCESS) {
          respCode = await this._ftmsCommand(FTMS_CMD_RESET);
          await this.sleep(500);
        }
        if (respCode == FTMS_RESP_SUCCESS) {
          respCode = await this._ftmsCommand(FTMS_CMD_REQUEST_CONTROL);
        }
      }
      catch(error) {
        return Promise.reject(`direto.init error : command failed (${error})`);
      }

      if (respCode != FTMS_RESP_SUCCESS) {
        return Promise.reject(`direto.init error : command failed (${respCode})`);
      }
      return respCode; // implicit Promise.resolve(respCode)
  } // init

    async start() {
      if (!this.connected) {
        return Promise.reject("direto.start error : not connected");
      }
      let respCode = FTMS_RESP_SUCCESS;
      try {
        // request control is not strictly necessary
        respCode = await this._ftmsCommand(FTMS_CMD_REQUEST_CONTROL);
        if (respCode == FTMS_RESP_SUCCESS) {
          respCode = await this._ftmsCommand(FTMS_CMD_START_RESUME);
        }
      }
      catch (error) {
        return Promise.reject(`direto.start error : command failed (${error})`);
      }

      if (respCode != FTMS_RESP_SUCCESS) {
        return Promise.reject(`direto.start error : command failed (${respCode})`);
      }
      return respCode; // implicit Promise.resolve(respCode)
    } // start

    async pause() {
      if (!this.connected) {
        return Promise.reject("direto.pause error : not connected");
      }
      let respCode = FTMS_RESP_SUCCESS;
      try {
        // request control is not strictly necessary
        respCode = await this._ftmsCommand(FTMS_CMD_REQUEST_CONTROL);
        if (respCode == FTMS_RESP_SUCCESS) {
          respCode = await this._ftmsCommand(FTMS_CMD_STOP_PAUSE, [{"type":"uint8", "val":FTMS_CMD_PARAM_PAUSE}]);
        }
      }
      catch (error) {
        return Promise.reject(`direto.pause error : command failed (${error})`);
      }

      if (respCode != FTMS_RESP_SUCCESS) {
        return Promise.reject(`direto.pause error : command failed (${respCode})`);
      }
      return respCode; // implicit Promise.resolve(respCode)
    } // pause

    async stop() {
      if (!this.connected) {
        return Promise.reject("direto.stop error : not connected");
      }
      let respCode = FTMS_RESP_SUCCESS;
      try {
        // request control is not strictly necessary
        respCode = await this._ftmsCommand(FTMS_CMD_REQUEST_CONTROL);
        if (respCode == FTMS_RESP_SUCCESS) {
          respCode = await this._ftmsCommand(FTMS_CMD_STOP_PAUSE, [{"type":"uint8", "val":FTMS_CMD_PARAM_STOP}]);
        }
      }
      catch (error) {
        return Promise.reject(`direto.stop error : command failed (${error})`);
      }

      if (respCode != FTMS_RESP_SUCCESS) {
        return Promise.reject(`direto.stop error : command failed (${respCode})`);
      }
      return respCode; // implicit Promise.resolve(respCode)
    } // stop

    async setResistance (resistanceLevel) {
      if (!this.connected) {
        return Promise.reject("direto.setResistance error : not connected");
      }
      let respCode = FTMS_RESP_SUCCESS;
      // todo range check
      // setting level = 0 gives INVALID PARAMETER error
      if (resistanceLevel == 0) resistanceLevel = 1;

      try {
        // request control is not strictly necessary
        // only if a cmd returns FTMS_RESP_CONTROL_NOT_PERMITTED
        respCode = await this._ftmsCommand(FTMS_CMD_REQUEST_CONTROL);
        if (respCode == FTMS_RESP_SUCCESS) {
          respCode = await this._ftmsCommand(FTMS_CMD_SET_RESISTANCE, [{"type":"uint8", "val":resistanceLevel}]);
        }
      }
      catch (error) {
        return Promise.reject(`direto.setResistance error : command failed (${error})`);
      }

      if (respCode != FTMS_RESP_SUCCESS) {
        return Promise.reject(`direto.setResistance error : command failed (${respCode})`);
      }
      return respCode; // implicit Promise.resolve(respCode)
    } // setResistance

    async setTargetPower (targetPowerLevel) {
      if (!this.connected) {
        return Promise.reject("direto.setTargetPower error : not connected");
      }
      let respCode = FTMS_RESP_SUCCESS;
      if (targetPowerLevel > 4000) targetPowerLevel = 4000;

      try {
        // request control is not strictly necessary
        // only if a cmd returns FTMS_RESP_CONTROL_NOT_PERMITTED
        respCode = await this._ftmsCommand(FTMS_CMD_REQUEST_CONTROL);
        if (respCode == FTMS_RESP_SUCCESS) {
          respCode = await this._ftmsCommand(
            FTMS_CMD_SET_TARGET_POWER, 
            [{"type":"int16", "val":targetPowerLevel}]);
        }
      }
      catch (error) {
        return Promise.reject(`direto.setTargetPower error : command failed (${error})`);
      }

      if (respCode != FTMS_RESP_SUCCESS) {
        return Promise.reject(`direto.setTargetPower error : command failed (${respCode})`);
      }
      return respCode; // implicit Promise.resolve(respCode)
    } // setTargetPower

    async getFitnessMachineFeatureInfo () {
      if (!this.connected) {
        return Promise.reject("direto.getFitnessMachineFeatureInfo error : not connected");
      }
      try {
        let value = await this._characteristics.get('fitness_machine_feature').readValue();
        // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
        value = value.buffer ? value : new DataView(value);
        let fitnessMachineFeatures = value.getUint32(0, /*littleEndian=*/true);
        let targetSettingFeatures = value.getUint32(4, /*littleEndian=*/true);
        log('Fitness Machine Feature Info :');
        log(`> fitnessMachineFeatures: ${fitnessMachineFeatures.toString(16)}`);
        log(`> targetSettingFeatures: ${targetSettingFeatures.toString(16)}`);
      } 
      catch(error)  {
        log(`direto.getFitnessMachineFeatureInfo error : failed reading characteristic : ${error}`);
        return Promise.reject(`direto.getFitnessMachineFeatureInfo error : failed reading characteristic : ${error}`);
      }
    } // getFitnessMachineFeatureInfo    

    async getSupportedResistanceLevelRange () {
      if (!this.connected) {
        return Promise.reject("direto.getSupportedResistanceLevelRange error : not connected");
      }
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
        log(`> minimumResistanceLevel: ${minimumResistanceLevel}`);
        log(`> maximumResistanceLevel: ${maximumResistanceLevel}`);
        log(`> minimumIncrement: ${minimumIncrement}`);
      } 
      catch(error)  {
        log(`direto.getSupportedResistanceLevelRange error : failed reading characteristic : ${error}`);
        return Promise.reject(`direto.getSupportedResistanceLevelRange error : failed reading characteristic : ${error}`);
      }
    } // getSupportedResistanceLevelRange    

    async getSupportedPowerRange () {
      if (!this.connected) {
        return Promise.reject("direto.getSupportedPowerRange error : not connected");
      }
      try {
        let value = await this._characteristics.get('supported_power_range').readValue();
        // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
        value = value.buffer ? value : new DataView(value);
        let minimumPowerLevel = value.getInt16(0, /*littleEndian=*/true);
        let maximumPowerLevel = value.getInt16(2, /*littleEndian=*/true);
        let minimumIncrement = value.getUint16(4, /*littleEndian=*/true);
        log('Supported Resistance Level Range Info :');
        log(`> minimumPowerLevel: ${minimumPowerLevel} Watts`);
        log(`> maximumPowerLevel: ${maximumPowerLevel} Watts`);
        log(`> minimumIncrement: ${minimumIncrement} Watts`);
      } 
      catch(error)  {
        log(`direto.getSupportedPowerRange error : failed reading characteristic : ${error}`);
        return Promise.reject(`direto.getSupportedPowerRange error : failed reading characteristic : ${error}`);
      }
    } // getSupportedPowerRange

    /*
      params [{"val":int,"type":str}]; type:"uint8","int16", others not yet needed
      returns : ftms response code or a rejected promise
      1 = SUCCESS, 3 = INVALID PARAMETER, 4 = FAILED, 5 = CONTROL NOT PERMITTED
    */
    
    async _ftmsCommand (cmd, params=[]) {
      // 2020.10.28 - quickfix to solve reentrancy issue when called from a setInterval.
      if (this._replyPromiseResolveFunc)
        // ftms in progress, simply ignore and pretend all is ok.
        return FTMS_RESP_SUCCESS;
      
      await this.sleep(20); // 2020.11.11 - test slow down successive writes to avoid the 'GATT operation in progress' exception

      let cmdBufferSize = 1;

      function addParam2View (view,offset, param) {
        let newOffset = offset;
        if (param.type == "uint8") {
          view.setUint8(offset,param.val);
          newOffset += 1;
        }
        else if (param.type == "int16") {
          view.setInt16(offset,param.val, /* little endian */ true);
          newOffset += 2;
        }
        return newOffset;
      } // addParam2View

      for (let i=0;i<params.length;i++) {
        if ((params[i].type == 'int8') || (params[i].type == 'uint8')) {
          cmdBufferSize += 1;
        }
        else if ((params[i].type == 'int16') || (params[i].type == 'uint16')) {
          cmdBufferSize += 2;
        }
      }
      let buffer = new ArrayBuffer(cmdBufferSize); // create an ArrayBuffer with a cmdBufferSize in bytes
      let view = new DataView(buffer); // Create a view
      // add cmd & params to the view/buffer
      let offset = 0;
      view.setUint8(offset, cmd);
      offset += 1;
      for (let i=0;i<params.length;i++) {
        offset = addParam2View (view,offset, params[i]);
      }

      try {
        const ftmscp = this._characteristics.get('fitness_machine_control_point');
        // 1. send command
        let cmdBytes = new Uint8Array(buffer);
        log(`_ftmsCommand : ${cmdBytes.toString()}`);
        // no await here!
        // we need to set up the reply promise synchronously, to be able to catch the reply notification in time
        // from the timings it looks that the reply notification comes very soon after the ftmscp.writeValue promise resolves
        ftmscp.writeValue(buffer);
        // 2. setup reply promise
        let replyPromise = new Promise((resolve,reject) => {
          this._replyPromiseResolveFunc = resolve; // and from here the installed listener will handle the promise
          // set 1s reject timeout on the reply
          // bind(this) not needed here because of the arrow function
          this._replyPromiseTimeoutId = setTimeout(() => {
            this._replyPromiseResolveFunc = null;
            log("_ftmsCommand : reply timeout!");
            reject("_ftmsCommand : reply timeout");
          }, 1000);
        });
        // 3. await reply
        const event = await replyPromise;
        this._replyPromiseResolveFunc = null;
        let evtData = event.target.value;
        // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
        evtData = evtData.buffer ? evtData : new DataView(evtData);
        // parsing data : TODO
        view = new Uint8Array(evtData.buffer);
        log(`ftmsCommand response code : ${view[2]}`)
        return (view[2]); /* the ftms cp response code */

      } catch(error)  {
        log(`_ftmsCommand : error ${error} in command ${view.toString()}`);
        this._replyPromiseResolveFunc = null;
        return Promise.reject(`direto._ftmsCommand error : command failed (${error})`);
      }
    } // _ftmsCommand

    async _startNotifications() {
      try {
        let indoorBikeData = this._characteristics.get('indoor_bike_data');
        let fitnessMachineControlPoint = this._characteristics.get('fitness_machine_control_point');
        let fitnessMachineStatus = this._characteristics.get('fitness_machine_status');
        let cyclingPowerMeasurement = this._characteristics.get('cycling_power_measurement');
        // let ntf11 = this._characteristics.get('347b0011-7635-408b-8918-8ff3949ce592');
        // let ntf14 = this._characteristics.get('347b0014-7635-408b-8918-8ff3949ce592');
        let ntf15 = this._characteristics.get('347b0015-7635-408b-8918-8ff3949ce592');
        // let ntf17 = this._characteristics.get('347b0017-7635-408b-8918-8ff3949ce592');

        /* android doesn't support simultaneous GATT actions .. */
        await indoorBikeData.startNotifications();
        await fitnessMachineControlPoint.startNotifications();
        await fitnessMachineStatus.startNotifications();
        await cyclingPowerMeasurement.startNotifications();
        // await ntf11.startNotifications();
        // await ntf14.startNotifications();
        await ntf15.startNotifications();
        // await ntf17.startNotifications();

        // todo : find a way to limit the scope of these listeners
        // can't be local to startNotifications, otherwise can't call removeEventListener later
        // bind(this) makes sure that in the callback 'this' refers to the direto context, rather than the caller's context
        indoorBikeData.addEventListener('characteristicvaluechanged', this._onIndoorBikeData.bind(this));
        fitnessMachineStatus.addEventListener('characteristicvaluechanged', this._onFitnessMachineStatus.bind(this));
        fitnessMachineControlPoint.addEventListener('characteristicvaluechanged', this._onFitnessMachineControlPoint.bind(this));
        cyclingPowerMeasurement.addEventListener('characteristicvaluechanged', this._onCyclingPowerMeasurement.bind(this));
        // ntf11.addEventListener('characteristicvaluechanged', this._onNtf11Data.bind(this));
        // ntf14.addEventListener('characteristicvaluechanged', this._onNtf14Data.bind(this));
        ntf15.addEventListener('characteristicvaluechanged', this._onNtf15Data.bind(this));
        // ntf17.addEventListener('characteristicvaluechanged', this._onNtf17Data.bind(this));

        log ("direto._startNotifications : OK!");
      } 
      catch(error) {
        log(`direto._startNotifications error : ${error}`);
        return Promise.reject(`direto._startNotifications error : ${error}`);
      }
    } // _startNotifications

    async _stopNotifications() {
      try {
        let indoorBikeData = this._characteristics.get('indoor_bike_data');
        let fitnessMachineControlPoint = this._characteristics.get('fitness_machine_control_point');
        let fitnessMachineStatus = this._characteristics.get('fitness_machine_status');
        let cyclingPowerMeasurement = this._characteristics.get('cycling_power_measurement');
        // let ntf11 = this._characteristics.get('347b0011-7635-408b-8918-8ff3949ce592');
        // let ntf14 = this._characteristics.get('347b0014-7635-408b-8918-8ff3949ce592');
        let ntf15 = this._characteristics.get('347b0015-7635-408b-8918-8ff3949ce592');
        // let ntf17 = this._characteristics.get('347b0017-7635-408b-8918-8ff3949ce592');

        /* android doesn't support simultaneous GATT actions .. */
        await indoorBikeData.stopNotifications();
        await fitnessMachineControlPoint.stopNotifications();
        await fitnessMachineStatus.stopNotifications();
        await cyclingPowerMeasurement.stopNotifications();
        // await ntf11.stopNotifications();
        // await ntf14.stopNotifications();
        await ntf15.stopNotifications();
        // await ntf17.stopNotifications();

        indoorBikeData.removeEventListener('characteristicvaluechanged', this._onIndoorBikeData);
        fitnessMachineStatus.removeEventListener('characteristicvaluechanged', this._onFitnessMachineStatus);
        fitnessMachineControlPoint.removeEventListener('characteristicvaluechanged', this._onFitnessMachineControlPoint);
        cyclingPowerMeasurement.removeEventListener('characteristicvaluechanged', this._onCyclingPowerMeasurement);
        // ntf11.removeEventListener('characteristicvaluechanged', this._onNtf11Data.bind(this));
        // ntf14.removeEventListener('characteristicvaluechanged', this._onNtf14Data.bind(this));
        ntf15.removeEventListener('characteristicvaluechanged', this._onNtf15Data.bind(this));
        // ntf17.removeEventListener('characteristicvaluechanged', this._onNtf17Data.bind(this));
        
        log ("direto._stopNotifications : OK!");
      } 
      catch(error) {
        log(`direto._stopNotifications error : ${error}`);
        return Promise.reject(`direto._stopNotifications error : ${error}`);
      }
    } // _stopNotifications

    // bind(this) forces 'this' to be the direto context, rather than remotegattcharacteristic context
    // so we can access this.bikeData rather than direto.bikeData
    _onIndoorBikeData (event) {
      let evtData = event.target.value;
      // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
      evtData = evtData.buffer ? evtData : new DataView(evtData);
      /*
      // log raw data
      let view8 = new Uint8Array(evtData.buffer);
      log ("bikeData : " + view8.toString());
      */
      // parse the pData according to the spec
      let flags = evtData.getUint16(0, /* littleEndian */ true);
      let idx = 2;
      if ((flags & 0x1) == 0) { // C1 contains instantaneous speed
        // 16-bit field is km/h with 0.01 resolution
        this.bikeData.instantaneousSpeed = evtData.getUint16(idx, /* littleEndian */ true) / 100.0;
        idx += 2;
      }
      if (flags & 0x2){ // C2 average speed - skip
        idx += 2;
      }
      if (flags & 0x4) { // C3 instantaneous cadence
        // 16-bit field is cadence with 0.5 resolution
        this.bikeData.instantaneousCadence = evtData.getUint16(idx, /* littleEndian */ true) >> 1;
        idx += 2;
      }
      if (flags & 0x8) { // C4 average cadence -- skip
        idx += 2;
      }
      if (flags & 0x10) { // C5 total distance - 3 bytes
        this.bikeData.totalDistance = evtData.getUint32(idx, /* littleEndian */ true) & 0xffffff; // 24-bits field
        idx += 3;
      }
      if (flags & 0x20) { // C6 resistance level
        this.bikeData.resistanceLevel = evtData.getUint16(idx, /* littleEndian */ true);
        idx += 2;
      }
      if (flags & 0x40) { // C7 instantaneous power
        this.bikeData.instantaneousPower = evtData.getUint16(idx, /* littleEndian */ true);
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
        this.bikeData.elapsedTime = evtData.getUint16(idx, /* littleEndian */ true);
      }

      if (this._eventListenerBikeData)
        this._eventListenerBikeData(this.bikeData);
    } // _onIndoorBikeData
    
    // here ftms status changes are reported
    _onFitnessMachineStatus(event) { 
      let evtData = event.target.value;
      // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
      evtData = evtData.buffer ? evtData : new DataView(evtData);
      // parsing data : TODO
      let view8 = new Uint8Array(evtData.buffer);
      log (`_onFitnessMachineStatus : ${view8.toString()}`);

    } // _onFitnessMachineStatus    

    // a fixed listener for ftms replies instead of a listener per command
    _onFitnessMachineControlPoint(event) {
      let evtData = event.target.value;
      // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
      evtData = evtData.buffer ? evtData : new DataView(evtData);
      // parsing data : TODO
      let view8 = new Uint8Array(evtData.buffer);
      log (`_onFitnessMachineControlPoint (direto reply) : ${view8.toString()}`);

      // handle the replyPromise here -> works better than installing an event listener on each ftms command
      if (this._replyPromiseResolveFunc) {
        this._replyPromiseResolveFunc(event);
        clearTimeout(this._replyPromiseTimeoutId);
      }
    } // _onFitnessMachineStatus
    
    _onCyclingPowerMeasurement(event) {
      let evtData = event.target.value;
      // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
      evtData = evtData.buffer ? evtData : new DataView(evtData);
      /*
      let view8 = new Uint8Array(evtData.buffer);
      log ("cps measurement : " + view8.toString());
      */
      // parse the pData according to the spec
      let flags = evtData.getUint16(0, /* littleEndian */ true);
      let idx = 2;
      this.bikeData.instantaneousPowerCPM = evtData.getUint16(idx, /* littleEndian */ true);
      idx += 2;
      
      if (flags & 0x1) {
        this.bikeData.pedalPowerBalance = evtData.getUint8(idx) >> 1; // percentage with resolution 1/2
        idx += 1;
      }
      if (flags & 0x2){
        // the direto detects the presence of the cadence sensor and now indicates that pedal balance reference = 'left', not longer 'unknown'
        this.hasCadenceSensor = true;
      }
      else {
        this.hasCadenceSensor = false;
      }
      if (flags & 0x4) { // accumulated torque - skip
        idx += 2;
      }  
      if (flags & 0x10) { // wheel rev data
        this.bikeData.cumulativeWheelRevolutions = evtData.getUint32(idx, /* littleEndian */ true);
        idx+= 4;
        this.bikeData.lastWheelEventTime = evtData.getUint16(idx, /* littleEndian */ true);
        idx += 2;
      }  
      if (flags & 0x20) { // crank rev data
        this.bikeData.cumulativeCrankRevolutions = evtData.getUint16(idx, /* littleEndian */ true);
        idx+= 2;
        this.bikeData.lastCrankEventTime = evtData.getUint16(idx, /* littleEndian */ true);
        idx += 2;
      }
      if (this._eventListenerBikeData)
        this._eventListenerBikeData(this.bikeData);
    } // _onCyclingPowerMeasurement


    _onNtf15Data(event) {
      let evtData = event.target.value;
      evtData = evtData.buffer ? evtData : new DataView(evtData);
      
      let view8 = new Uint8Array(evtData.buffer);
      //log ("ntf15 : " + view8.toString()); // log raw data
      
      let id = evtData.getUint8(0);
      for (let i=0;i<8;i++) {
        let aData = evtData.getUint16(4+2*i, true);
        if (aData == 0xFFFF)
          this.pedalAnalysisData.peanut[(id-1)*8+i]= undefined;
        else
          this.pedalAnalysisData.peanut[(id-1)*8+i]= aData;
      }
      this.pedalAnalysisData.cadence = evtData.getUint8(3);
      this.pedalAnalysisData.aValue = evtData.getUint16(1,true); /* power or speed, not clear ? */
      if (id == 3) {
        // we have a complete set of new peanut data
        // summarize statistics
        //this.pedalAnalysisData.maxPower = Math.max(...this.pedalAnalysisData.peanut);
        //this.pedalAnalysisData.minPower = Math.min(...this.pedalAnalysisData.peanut);
        this.pedalAnalysisData.maxPower = this.pedalAnalysisData.peanut.reduce((max,v)=> {return Math.max(max,v||0);},0);
        this.pedalAnalysisData.minPower = this.pedalAnalysisData.peanut.reduce((min,v)=> {return Math.min(min,v||0xFFFF);},0xFFFF);
        this.pedalAnalysisData.avgPower = this.pedalAnalysisData.peanut.reduce((tot,v)=> {return tot+(v||0);},0) / 
                                          this.pedalAnalysisData.peanut.reduce((cnt,v)=> {return cnt+(!isNaN(v));},0);
                                    //this.pedalAnalysisData.peanut.length;
        this.pedalAnalysisData.uniformity = 100.0* this.pedalAnalysisData.avgPower / this.pedalAnalysisData.maxPower;

        if (this._eventListenerPedalAnalysisData)
          this._eventListenerPedalAnalysisData(this.pedalAnalysisData);
      }
    } // ntf15

    // not used for now
    _onNtf11Data(event) { // seems to sends 0 all the time during normal operation
      let evtData = event.target.value;
      evtData = evtData.buffer ? evtData : new DataView(evtData);
      let view8 = new Uint8Array(evtData.buffer);
      log ("ntf11 : " + view8.toString()); // log raw data
    } // ntf11

    // not used for now
    _onNtf14Data(event) {
      let evtData = event.target.value;
      evtData = evtData.buffer ? evtData : new DataView(evtData);
      let view8 = new Uint8Array(evtData.buffer);
      log ("ntf14 : " + view8.toString()); // log raw data
    } // ntf14

    // not used for now
    _onNtf17Data(event) {
      let evtData = event.target.value;
      evtData = evtData.buffer ? evtData : new DataView(evtData);
      let view8 = new Uint8Array(evtData.buffer);
      log ("ntf17 : " + view8.toString()); // log raw data
    } // ntf17
   

    /* Utils */
    _cacheCharacteristic(service, characteristicUuid) {
      return service.getCharacteristic(characteristicUuid)
      .then((characteristic) => {
        log(`found characteristic ${characteristic.uuid}`);
        this._characteristics.set(characteristicUuid, characteristic);
      });
    }
  } // direto class

  window.direto = new Direto();

})();
