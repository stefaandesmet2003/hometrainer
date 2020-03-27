(function() {
  'use strict';

  class Hrm {
    constructor() {
      this.device = null;
      this.server = null;
      this.connected = false; // setting true only if all necessary services/characteristics are found
      this.heartData = {};
      this._characteristics = new Map();
      this._eventListener = null;
      this._replyPromiseResolveFunc = null;
      this._replyPromiseTimeoutId;
    }

    // reimplementation with async/await
    // try/catch not required, without it a rejected ble promise will bubble up to the caller anyway
    async connect() {
      try {
        // 1. find BLE device
        // without specifying the optional services here, webble won't give us access to these services later on
        // same issue with navigator.bluetooth.requestDevice({acceptAllDevices:true})
        let device = await navigator.bluetooth.requestDevice({
          filters:[{services:['heart_rate']}],
          //optionalServices: ['heart_rate']
        });
        this.device = device;
        device.addEventListener('gattserverdisconnected', this._onDisconnected.bind(this));
        
        // 2. connect to its GATT server
        let server = await device.gatt.connect();
        log("hrm.connect: gatt server connected!");
        this.server = server;

        // 3. Heart_rate service
        let service = await server.getPrimaryService('heart_rate');
        log("hrm.connect : found heart_rate service!");

        // 4. Heart_rate characteristics
        await Promise.all ([
          this._cacheCharacteristic(service, 'heart_rate_measurement'),
        ]);

        this.connected = true;
      }
      catch (error) {
        // come here if anything above fails
        log(`hrm.connect : BLE error : ${error}`);
        return Promise.reject(`hrm.connect : BLE error : ${error}`);
      }
    } // connect

    _onDisconnected(event) {
      log("hrm._onDisconnected : OK!");
      this.server = null;
      this.device = null;
      this.connected = false;
      this._characteristics.clear(); // clear all key:value pairs in the map
      this._eventListener = null;

    } // _onDisconnected

    // reimplementation with async/await
    // try/catch not required, without it a rejected ble promise will bubble up to the caller anyway
    async disconnect() {
      if (this.server) {
        try {
          await this._stopNotifications();
          log("hrm.disconnect : OK!");
          await this.server.disconnect();
          // this will trigger _onDisconnected
        }
        catch(error) {
          log(`hrm.disconnect error : ${error}`);
          return Promise.reject(`hrm.disconnect error : ${error}`);
        }
      }
      else {
        // internal error or already disconnected
        log("hrm.disconnect : already disconnected??");
      }
      return;
    } // disconnect

    // install callback for bikeData
    addEventListener(type, callbackFunction) {
      // don't care about the type;
      type = 'heartdata';
      this._eventListener = callbackFunction;
    } // addEventListener

    async init() {
      if (!this.connected) {
        return Promise.reject("hrm.init error : not connected");
      }
      try {
        await this._startNotifications();
      }
      catch(error) {
        return Promise.reject(`hrm.init error : command failed (${error})`);
      }

  } // init

    async _startNotifications() {
      try {
        let heartData = this._characteristics.get('heart_rate_measurement');
        await Promise.all([
          heartData.startNotifications(),
        ]);
        // todo : find a way to limit the scope of these listeners
        // can't be local to startNotifications, otherwise can't call removeEventListener later
        // bind(this) makes sure that in the callback 'this' refers to the direto context, rather than the caller's context
        heartData.addEventListener('characteristicvaluechanged', this._onHeartData.bind(this));
        log ("hrm._startNotifications : OK!");
      } 
      catch(error) {
        log(`hrm._startNotifications error : ${error}`);
        return Promise.reject(`hrm._startNotifications error : ${error}`);
      }
    } // _startNotifications

    async _stopNotifications() {
      try {
        let heartData = this._characteristics.get('heart_rate_measurement');
        await Promise.all([
          heartData.stopNotifications(),
        ]);
        heartData.removeEventListener('characteristicvaluechanged', this._onHeartData);
        log ("hrm._stopNotifications : OK!");

      } 
      catch(error) {
        log(`hrm._stopNotifications error : ${error}`);
        return Promise.reject(`hrm._stopNotifications error : ${error}`);
      }
    } // _stopNotifications

    // bind(this) forces 'this' to be the hrm context, rather than remotegattcharacteristic context
    // so we can access this.heartData rather than hrm.bikeData
    _onHeartData (event) {
      let evtData = event.target.value;
      // In Chrome 50+, a DataView is returned instead of an ArrayBuffer.
      evtData = evtData.buffer ? evtData : new DataView(evtData);
      
      // log raw data
      /*
      let view8 = new Uint8Array(evtData.buffer);
      log ("hrmData : " + view8.toString());
      */
      // parse the data according to the spec
      let flags = evtData.getUint8(0);
      let idx = 1;
      if ((flags & 0x1) == 0) { // bpm in UINT8
        this.heartData.heartRate = evtData.getUint8(idx);
        idx += 1;
      }
      else { // bpm in UINT16
        this.heartData.heartRate = evtData.getUint16(idx, /* littleEndian */ true);
        idx += 2;
      }
      if (flags & 0x8) { // energy expended data
        this.heartData.energyExpended = evtData.getUint16(idx, /* littleEndian */ true);
        idx += 2;
      }

      if (this._eventListener)
        this._eventListener(this.heartData);
    } // _onHeartData

    /* Utils */
    _cacheCharacteristic(service, characteristicUuid) {
      return service.getCharacteristic(characteristicUuid)
      .then((characteristic) => {
        log(`found characteristic ${characteristic.uuid}`);
        this._characteristics.set(characteristicUuid, characteristic);
      });
    }
  } // hrm class

  window.hrm = new Hrm();

})();