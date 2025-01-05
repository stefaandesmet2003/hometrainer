(function() {
  'use strict';
  // ftms commands
  const FTMS_CMD_REQUEST_CONTROL = 0;
  const FTMS_CMD_RESET = 1;
  const FTMS_CMD_SET_RESISTANCE = 4;
  const FTMS_CMD_SET_TARGET_POWER = 5;
  const FTMS_CMD_START_RESUME = 7;
  const FTMS_CMD_STOP_PAUSE = 8;
  const FTMS_CMD_SET_INDOOR_BIKE_SIMULATION_PARAMETERS = 17;
  const FTMS_CMD_SET_WHEEL_CIRCUMFERENCE = 18;
  const FTMS_CMD_PARAM_STOP = 1;
  const FTMS_CMD_PARAM_PAUSE = 2;
  // ftms response codes
  const FTMS_RESP_SUCCESS = 1;
  const FTMS_RESP_INVALID_PARAMETER = 3;
  const FTMS_RESP_FAILED = 4;
  const FTMS_RESP_CONTROL_NOT_PERMITTED = 5;
  // ftms status codes
  const FTMS_STATUS_RESET = 1;
  const FTMS_STATUS_STOPPED_PAUSED_BY_USER = 2;
  const FTMS_STATUS_STARTED_BY_USER = 4;
  const FTMS_STATUS_RESISTANCE_LEVEL_CHANGED = 7;
  const FTMS_STATUS_POWER_LEVEL_CHANGED = 8;
  const FTMS_STATUS_WHEEL_CIRCUMFERENCE_CHANGED = 19;
  // others not used here

  class FTMS {
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
      this.logFtmsCommands = false;
    }

    async connect() {
      try {
        // 1. find BLE device
        // without specifying the optional services here, webble won't give us access to these services later on
        // same issue with navigator.bluetooth.requestDevice({acceptAllDevices:true})
        let device = await navigator.bluetooth.requestDevice({
          filters:[{services:['fitness_machine']}],
        });
        this.device = device;
        this._onDisconnectFunc = this._onDisconnected.bind(this);
        device.addEventListener('gattserverdisconnected', this._onDisconnectFunc, {once:true});
        
        // 2. connect to its GATT server
        let server = await device.gatt.connect();
        log("FTMS.connect: gatt server connected!");

        // 3. Fitness Machine service
        let service = await server.getPrimaryService('fitness_machine');
        log("FTMS.connect : found ftms service!");

        // 4. Fitness Machine characteristics
        // no idea what Promise.all returns, but don't need the return value
        await Promise.all ([
          this._cacheCharacteristic(service, 'indoor_bike_data'),
          this._cacheCharacteristic(service, 'fitness_machine_control_point'),
        ]);
        this.connected = true;
      }
      catch (error) {
        // come here if anything above fails
        log(`FTMS.connect : BLE error : ${error}`);
        // both statements do the same, correct?
        //throw new Error("connect : BLE error");
        return Promise.reject(`FTMS.connect : BLE error : ${error}`);
      }
    } // connect

    _onDisconnected(event) {
      log("FTMS._onDisconnected : OK!");
      this.device.removeEventListener('gattserverdisconnected', this._onDisconnectFunc);
      this.connected = false;
      this._characteristics.clear(); // clear all key:value pairs in the map
      this._eventListenerBikeData = null;
      this._eventListenerPedalAnalysisData = null;
    } // _onDisconnected

    async disconnect() {
      let server = this.device.gatt;
      if (server.connected) {
        try {
          await this._stopNotifications();
          await server.disconnect();
          // this will trigger _onDisconnected
          log("FTMS.disconnect : OK!");
        }
        catch(error) {
          log(`FTMS.disconnect error : ${error}`);
          return Promise.reject(`FTMS.disconnect error : ${error}`);
        }
      }
      else {
        // internal error or already disconnected
        log("FTMS.disconnect : already disconnected??");
      }
      // why do we keep receiving double onDisconnected logs after a few connect/disconnects ??
      this.device.removeEventListener('gattserverdisconnected', this._onDisconnectFunc);

      return;
    } // disconnect

    // install callback for bikeData
    addEventListener(type, callbackFunction) {
      if (type == 'onbikedata') {
        this._eventListenerBikeData = callbackFunction;
      }
      else if (type == 'pedaldata') {
        this._eventListenerPedalAnalysisData = callbackFunction;
      }
    } // addEventListener

    // remove callback for bikeData - totally useless
    removeEventListener(type, callbackFunction) {
      if (type == 'onbikedata') {
        this._eventListenerBikeData = null;
      }
      else if (type == 'pedaldata') {
        this._eventListenerPedalAnalysisData = null;
      }
    } // addEventListener

    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve,ms));
    }

    async init() {
      if (!this.connected) {
        return Promise.reject("FTMS.init error : not connected");
      }
      let respCode = FTMS_RESP_SUCCESS;
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
        return Promise.reject(`FTMS.init error : command failed (${error})`);
      }

      if (respCode != FTMS_RESP_SUCCESS) {
        return Promise.reject(`FTMS.init error : command failed (${respCode})`);
      }
      return respCode; // implicit Promise.resolve(respCode)
    } // init

    async start() {
      if (!this.connected) {
        return Promise.reject("FTMS.start error : not connected");
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
        return Promise.reject(`FTMS.start error : command failed (${error})`);
      }

      if (respCode != FTMS_RESP_SUCCESS) {
        return Promise.reject(`FTMS.start error : command failed (${respCode})`);
      }
      return respCode; // implicit Promise.resolve(respCode)
    } // start

    async pause() {
      if (!this.connected) {
        return Promise.reject("FTMS.pause error : not connected");
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
        return Promise.reject(`FTMS.pause error : command failed (${error})`);
      }

      if (respCode != FTMS_RESP_SUCCESS) {
        return Promise.reject(`FTMS.pause error : command failed (${respCode})`);
      }
      return respCode; // implicit Promise.resolve(respCode)
    } // pause

    async stop() {
      if (!this.connected) {
        return Promise.reject("FTMS.stop error : not connected");
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
        return Promise.reject(`FTMS.stop error : command failed (${error})`);
      }

      if (respCode != FTMS_RESP_SUCCESS) {
        return Promise.reject(`FTMS.stop error : command failed (${respCode})`);
      }
      return respCode; // implicit Promise.resolve(respCode)
    } // stop

    async setResistance (resistanceLevel) {
      if (!this.connected) {
        return Promise.reject("FTMS.setResistance error : not connected");
      }
      let respCode = FTMS_RESP_SUCCESS;
      // todo range check
      // setting level = 0 gives INVALID PARAMETER error
      if (resistanceLevel == 0) resistanceLevel = 1;
      if (this.logFtmsCommands) log(`setResistance to ${resistanceLevel}`);

      try {
        // request control is not strictly necessary
        // only if a cmd returns FTMS_RESP_CONTROL_NOT_PERMITTED
        respCode = await this._ftmsCommand(FTMS_CMD_REQUEST_CONTROL);
        if (respCode == FTMS_RESP_SUCCESS) {
          respCode = await this._ftmsCommand(FTMS_CMD_SET_RESISTANCE, [{"type":"uint8", "val":resistanceLevel}]);
        }
      }
      catch (error) {
        return Promise.reject(`FTMS.setResistance error : command failed (${error})`);
      }

      if (respCode != FTMS_RESP_SUCCESS) {
        return Promise.reject(`FTMS.setResistance error : command failed (${respCode})`);
      }
      return respCode; // implicit Promise.resolve(respCode)
    } // setResistance

    async setTargetPower (targetPowerLevel) {
      if (!this.connected) {
        return Promise.reject("FTMS.setTargetPower error : not connected");
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
        return Promise.reject(`FTMS.setTargetPower error : command failed (${error})`);
      }

      if (respCode != FTMS_RESP_SUCCESS) {
        return Promise.reject(`FTMS.setTargetPower error : command failed (${respCode})`);
      }
      return respCode; // implicit Promise.resolve(respCode)
    } // setTargetPower

    async setSimulationParameters (gradeInPct,windSpeedInMs=0,crr=0.0033,cw=0.65) {
      if (!this.connected) {
        return Promise.reject("FTMS.setSimulationParameters error : not connected");
      }
      let respCode = FTMS_RESP_SUCCESS;
      gradeInPct = ~~(gradeInPct * 100 + 0.5) & 0xFFFF; // in 0.01% acc. FTMS spec
      windSpeedInMs = ~~(windSpeedInMs * 1000 + 0.5) & 0xFFFF; // in 0.001m/s acc. FTMS spec
      crr = ~~(crr*10000+0.5) & 0xFF; // in 0.0001 acc. FTMS spec
      cw = ~~(cw*100 + 0.5) & 0xFF;  // in 0.01 acc. FTMS spec

      try {
        // request control is not strictly necessary
        // only if a cmd returns FTMS_RESP_CONTROL_NOT_PERMITTED
        respCode = await this._ftmsCommand(FTMS_CMD_REQUEST_CONTROL);
        if (respCode == FTMS_RESP_SUCCESS) {
          respCode = await this._ftmsCommand(
            FTMS_CMD_SET_INDOOR_BIKE_SIMULATION_PARAMETERS, 
            [{"type":"int16", "val":windSpeedInMs},
              {"type":"int16", "val":gradeInPct},
              {"type":"uint8", "val":crr},
              {"type":"uint8", "val":cw}
            ]);
        }
      }
      catch (error) {
        return Promise.reject(`FTMS.setSimulationParameters error : command failed (${error})`);
      }

      if (respCode != FTMS_RESP_SUCCESS) {
        return Promise.reject(`FTMS.setSimulationParameters error : command failed (${respCode})`);
      }
      return respCode; // implicit Promise.resolve(respCode)
    } // setSimulationParameters

    async setWheelCircumference (wheelCircumferenceInMm) {
      if (!this.connected) {
        return Promise.reject("direto.setWheelCircumference error : not connected");
      }
      let respCode = FTMS_RESP_SUCCESS;
      wheelCircumferenceInMm = wheelCircumferenceInMm * 10; // in 0.1mm acc. FTMS spec
      if (wheelCircumferenceInMm > 0xFFFF) wheelCircumferenceInMm = 0xFFFF; // limit to uint16

      try {
        // request control is not strictly necessary
        // only if a cmd returns FTMS_RESP_CONTROL_NOT_PERMITTED
        respCode = await this._ftmsCommand(FTMS_CMD_REQUEST_CONTROL);
        if (respCode == FTMS_RESP_SUCCESS) {
          respCode = await this._ftmsCommand(
            FTMS_CMD_SET_WHEEL_CIRCUMFERENCE, 
            [{"type":"uint16", "val":wheelCircumferenceInMm}]);
        }
      }
      catch (error) {
        return Promise.reject(`direto.setWheelCircumference error : command failed (${error})`);
      }

      if (respCode != FTMS_RESP_SUCCESS) {
        return Promise.reject(`direto.setWheelCircumference error : command failed (${respCode})`);
      }
      return respCode; // implicit Promise.resolve(respCode)
    } // setWheelCircumference

    /*
      params [{"val":int,"type":str}]; 
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
        else if (param.type == "uint16") {
          view.setUint16(offset,param.val, /* little endian */ true);
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
        if (this.logFtmsCommands) log(`_ftmsCommand : ${cmdBytes.toString()}`);
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
            if (this.logFtmsCommands) log("_ftmsCommand : reply timeout!");
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
        if (this.logFtmsCommands) log(`ftmsCommand response code : ${view[2]}`)
        return (view[2]); /* the ftms cp response code */

      } catch(error)  {
        if (this.logFtmsCommands) log(`_ftmsCommand : error ${error} in command ${view.toString()}`);
        this._replyPromiseResolveFunc = null;
        return Promise.reject(`FTMS._ftmsCommand error : command failed (${error})`);
      }
    } // _ftmsCommand

    async _startNotifications() {
      try {
        let indoorBikeData = this._characteristics.get('indoor_bike_data');
        let fitnessMachineControlPoint = this._characteristics.get('fitness_machine_control_point');
        await indoorBikeData.startNotifications();
        await fitnessMachineControlPoint.startNotifications();
        indoorBikeData.addEventListener('characteristicvaluechanged', this._onIndoorBikeData.bind(this));
        fitnessMachineControlPoint.addEventListener('characteristicvaluechanged', this._onFitnessMachineControlPoint.bind(this));
        log ("FTMS._startNotifications : OK!");
      } 
      catch(error) {
        log(`FTMS._startNotifications error : ${error}`);
        return Promise.reject(`FTMS._startNotifications error : ${error}`);
      }
    } // _startNotifications

    async _stopNotifications() {
      try {
        let indoorBikeData = this._characteristics.get('indoor_bike_data');
        let fitnessMachineControlPoint = this._characteristics.get('fitness_machine_control_point');
        await indoorBikeData.stopNotifications();
        await fitnessMachineControlPoint.stopNotifications();
        indoorBikeData.removeEventListener('characteristicvaluechanged', this._onIndoorBikeData);
        fitnessMachineControlPoint.removeEventListener('characteristicvaluechanged', this._onFitnessMachineControlPoint);
        log ("FTMS._stopNotifications : OK!");
      } 
      catch(error) {
        log(`FTMS._stopNotifications error : ${error}`);
        return Promise.reject(`FTMS._stopNotifications error : ${error}`);
      }
    } // _stopNotifications

    // bind(this) forces 'this' to be the FTMS context, rather than remotegattcharacteristic context
    // so we can access this.bikeData rather than FTMS.bikeData
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
      if (flags & 0x200) { // C10 heart rate - skip
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
    
    // a fixed listener for ftms replies instead of a listener per command
    _onFitnessMachineControlPoint(event) {
      let evtData = event.target.value;
      // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
      evtData = evtData.buffer ? evtData : new DataView(evtData);
      // parsing data : TODO
      let view8 = new Uint8Array(evtData.buffer);
      //response consists of 3 UINT8 : ResponseCode (0x80), Request OpCode, ResultCode (§4.16.2.22)
      let resultCode = view8[2];
      if (resultCode != FTMS_RESP_SUCCESS) 
        log (`_onFitnessMachineControlPoint (FTMS ERROR reply) : ${view8.toString()}`); // always log error replies for now
      else {
        if (this.logFtmsCommands) log (`_onFitnessMachineControlPoint (FTMS OK reply) : ${view8.toString()}`);
      }

      // handle the replyPromise here -> works better than installing an event listener on each ftms command
      if (this._replyPromiseResolveFunc) {
        this._replyPromiseResolveFunc(event);
        clearTimeout(this._replyPromiseTimeoutId);
      }
    } // _onFitnessMachineStatus

    /* Utils */
    _cacheCharacteristic(service, characteristicUuid) {
      return service.getCharacteristic(characteristicUuid)
      .then((characteristic) => {
        log(`found characteristic ${characteristic.uuid}`);
        this._characteristics.set(characteristicUuid, characteristic);
      });
    }
  } // FTMS class

  window.FTMS = new FTMS();

})();
