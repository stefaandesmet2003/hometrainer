
var connection;
var resistanceValue;

// the actual values from BLE
var bikeDataPower = 200; // for simulation
var bikeDataCadence = 0;
var bikeDataElapsedTime = 0;
var bikeDataPedalBalance = 0;
  
function dongleConnect() {
  connection = new WebSocket('ws://192.168.1.9:81/',['arduino']);
  //connection = new WebSocket('ws://esp32dongle.local:81/',['arduino']);
  //connection = new WebSocket('ws://esp32dongle:81/',['arduino']);
  //connection = new WebSocket('ws://espressif:81/',['arduino']);
  //connection = new WebSocket('ws://espressif.local:81/',['arduino']);
  connection.onmessage = onDongleMessage;
  connection.onopen = onDongleOpen;
  connection.onerror = onDongleError;
  connection.onclose = onDongleClose;
} // connectWebSocket

function onDongleOpen() {
  console.log("websocket connection open!");
} // onDongleOpen

function onDongleError(error) {
  console.log("websocket error!");
} // onDongleError

function onDongleClose(e) {
  console.log("websocket closed with code : " + e.code);
} // onDongleClose

function onDongleMessage(e) {
  //console.log('Server sent : ', e.data);
  // data are in json format
  var json = JSON.parse(e.data);
  bikeDataPower = json.data.pow;
  bikeDataCadence = json.data.cad;
  bikeDataElapsedTime = json.data.elTim;
  bikeDataPedalBalance = json.data.bal;
  
} // onDongleMessage

function dongleCmdChangeResistance(resistanceValue) {
  console.log("dongleCmdChangeResistance to " + resistanceValue);
  var jsonData = { event : "cmd",
                   cmd : {RESISTANCE : resistanceValue}
                 };
  console.log (JSON.stringify(jsonData));
  if (connection) {
    if (connection.readyState == 1) {//open
      connection.send(JSON.stringify(jsonData));
    }
  }
  else {
    console.log("no websocket connection, not sending data now");
  }
} // dongleCmdChangeResistance

function dongleCmdStart() {
  console.log("dongleCmdStart");
  var jsonData = { event : "cmd",
                   cmd : {"START" : 1}
                 };
  console.log (JSON.stringify(jsonData));
  if (connection) {
    if (connection.readyState == 1) {//open
      connection.send(JSON.stringify(jsonData));
    }
  }
  else {
    console.log("no websocket connection, not sending data now");
  }
} // dongleCmdStart

function dongleCmdStop() {
  console.log("dongleCmdStop");
  var jsonData = { event : "cmd",
                   cmd : {"STOP" : 1}
                 };
  console.log (JSON.stringify(jsonData));
  if (connection) {
    if (connection.readyState == 1) {//open
      connection.send(JSON.stringify(jsonData));
    }
  }
  else {
    console.log("no websocket connection, not sending data now");
  }
} // dongleCmdStop

function dongleDisconnect() {
  connection.close();
} // dongleDisconnect
