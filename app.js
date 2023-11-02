'use strict';
// all window scope stuff
// html interface
let buttonRide;
let buttonDownload, buttonUpload;
let buttonConnectTrainer, buttonConnectHrm;
let simulator;
let rider;
let ghost;

// modal menu
let menu;
let menuButton;
let closeMenu;
let buttonSaveSettings;

// pedal chart
let radarChart, radarCfg, radarCtx;
let peanuts = [];
let theRides;

// strava stuff
let stravaUploadPollTimer, stravaAccessToken;

async function onBodyLoad() {
  document.getElementById("fileVideo").onchange = videoFileOnChange;
  document.getElementById("fileTrack").onchange = trackFileOnChange;
  buttonRide = document.getElementById("buttonRide");
  buttonRide.onclick = buttonRideOnClick;
  buttonDownload = document.getElementById("buttonDownload");
  buttonDownload.onclick = buttonDownloadOnClick;
  buttonUpload = document.getElementById("buttonUpload");
  buttonUpload.onclick = buttonUploadOnClick;
  buttonConnectTrainer = document.getElementById("buttonConnectTrainer");
  buttonConnectTrainer.onclick = buttonConnectTrainerOnClick;
  buttonConnectHrm = document.getElementById("buttonConnectHrm");
  buttonConnectHrm.onclick = buttonConnectHrmOnClick;

  // pedal chart
  radarCtx = document.getElementById('myRadarChart').getContext('2d');
  radarCfg = {
      type: 'radar',
      data: {
        //labels : [0,30,60,90,120,150,180,210,240,270,300,330],
        labels : [0,15,30,45,60,75,90,105,120,135,150,165,180,195,210,225,240,255,270,285,300,315,330,345],
        datasets: [
        {
          label: 'stroke1',
          backgroundColor: 'white',
          borderColor: 'white',
          data : peanuts[0],
        },
      ]
      },
      options: {
        legend : {
          display : false,
        },
        animation : false,
        hover: {
          animationDuration: 0 // duration of animations when hovering an item
        },
        responsive : false,
        responsiveAnimationDuration: 0, // animation duration after a resize
        elements: { // settings for all datasets, can be overridden per dataset
          line : {
            tension : 0, // 0 = disable bezier curves
            fill : false,
            stepped : false,
            borderWidth : 2,
            borderDash: [],
          },
          point  : {
            radius : 2, // 0 = no dot on the datapoint
          }
        },
        showLine : true,
        parsing : false,
        spanGaps : true,

        scale: {
          /*
          angleLines : {
            display : true,
            color : "#666",
            borderDash : [10,5],
          },
          */
          angleLines : {
            display : false,
          },
          pointLabels : { // angle values along the circle
            display : false,
            fontColor : "white",
          },
          gridLines : {
            display : true,
            color : "white",
          },
          // trick to remove ticks https://medium.com/@richard.jones/getting-rid-of-radar-chart-ticks-in-chartjs-dda06bef2711#:~:text=Unfortunately%20ChartJS%20does%20not%20provide,be%20creative%20in%20removing%20them.&text=This%20removes%20the%20backdrop%20not,%25%20opacity%20%E2%80%94%20i.e.%20totally%20transparent.
          /*
          ticks: {
            callback: function() {return ""},
            backdropColor: "rgba(0, 0, 0, 0)",
          },
          */
          ticks : {
            min : 0,
            fontColor : "white",
            fontSize : 20,
            max : 200, // initial value, is later updated based on pedaldata, overriding the autoscaling in ChartJs
            showLabelBackdrop : false,
            maxTicksLimit : 1,
          },
        },
      } // options

    };
    radarChart = new Chart(radarCtx, radarCfg);

  
  simulator = new Simulator();
  let settings = getStoredSettings();
  
  document.getElementById("settingRiderWeight").value = String(settings.riderWeight);
  document.getElementById("settingTrainerDifficulty").value = String(settings.trainerDifficulty);
  rider = new Rider(settings.riderWeight);
  rider.setTrainer();
  simulator.addRider(rider);
  rider.setTrainerDifficulty(settings.trainerDifficulty);

  theRides = await axios.get('./rides/rides.json').then((res) => {
    return res.data;
  });
  // load rides in the choosing table
  initRidesTable();

  // for test load a track url -> first item in theRides table
  let track = new Track(theRides[0]);
  await track.loadUrl(theRides[0].track_url);
  simulator.setTrack(track);
  simulator.loadVideoFromUrl(theRides[0].video_url);

  // modal menu
  menu = document.getElementById("menu");
  menuButton = document.getElementById("buttonMenu");
  closeMenu = document.getElementsByClassName("close")[0];
  buttonSaveSettings = document.getElementById("buttonSaveSettings");
  buttonSaveSettings.onclick = buttonSaveSettingsOnClick;

  // When the user clicks on the button, open the modal
  menuButton.onclick = function() {
    menu.style.display = "block";
  }

  // When the user clicks on <span> (x), close the modal
  closeMenu.onclick = function() {
    menu.style.display = "none";
  }

  // When the user clicks anywhere outside of the modal, close it
  window.onclick = function(event) {
    if (event.target == menu) {
      menu.style.display = "none";
    }
  }

  // strava auth stuff
  // server stuurt het token terug met de return-page op token_exchange, en client voert de localStorage.setItem('token') javascript uit
  window.addEventListener('storage', () => {
    stravaAccessToken = localStorage.getItem('token');
  });
  localStorage.clear(); // clear token from previous 'session'

} // onBodyLoad

function buttonSaveSettingsOnClick() {
  let riderWeight = parseFloat(document.getElementById("settingRiderWeight").value);
  let trainerDifficulty = parseFloat(document.getElementById("settingTrainerDifficulty").value);
  // store settings in cookies
  document.cookie = `riderWeight=${riderWeight};path=/;expires=Fri, 31 Dec 9999 23:59:59 GMT`;
  document.cookie = `trainerDifficulty=${trainerDifficulty};path=/;expires=Fri, 31 Dec 9999 23:59:59 GMT`;
  // create a new Rider object or restart the page
  rider.setRiderWeight(riderWeight);
  rider.setTrainerDifficulty(trainerDifficulty);
  log(`new settings stored : rider weight : ${riderWeight}, trainer difficulty : ${trainerDifficulty}`);
} // buttonSaveSettingsOnClick

function getStoredSettings() {
  let settings = {};
  let cookieRiderWeight = getCookie("riderWeight");
  if (cookieRiderWeight != "") {
    settings.riderWeight = parseFloat(cookieRiderWeight);
  }
  else {
    // can't find the cookie -> use default and set cookie
    settings.riderWeight = 75.1;
    document.cookie = `riderWeight=${settings.riderWeight};path=/;expires=Fri, 31 Dec 9999 23:59:59 GMT`;
  }
  let cookieTrainerDifficulty = getCookie("trainerDifficulty");
  if (cookieTrainerDifficulty != "") {
    settings.trainerDifficulty = parseFloat(cookieTrainerDifficulty);
  }
  else {
    // can't find the cookie -> use default and set cookie
    settings.trainerDifficulty = 100.0;
    document.cookie = `trainerDifficulty=${settings.trainerDifficulty};path=/;expires=Fri, 31 Dec 9999 23:59:59 GMT`;
  }

  return settings;
} // getStoredSettings

function getCookie(cname) {
  var name = cname + "=";
  var decodedCookie = decodeURIComponent(document.cookie);
  var ca = decodedCookie.split(';');
  for(var i = 0; i <ca.length; i++) {
    var c = ca[i].trim();
    if (c.indexOf(name) == 0) {
      return c.substring(name.length, c.length);
    }
  }
  return "";
} // getCookie

function videoFileOnChange(evt) {
  let id = evt.target.id; // 
  let files = evt.target.files; // FileList object
  if (files.length == 0)
    return;
  // files[0] is the video file
  simulator.loadVideoFromFile(files[0]);

  // for test : remove the 'video!' button after chosen a video
  document.getElementById('buttonFileVideo').style = "display:none";
  
} // videoFileOnChange

async function trackFileOnChange(evt) {
  let id = evt.target.id; // voor het geval we verschillende choose file buttons zouden gaan gebruiken die allemaal naar deze functie wijzen
  let files = evt.target.files; // FileList object
  
  // voorlopig wordt maar enkel de 1ste file uit de FileList geparsed
  
  if (files.length == 0)
    return;
  // files[0] is the track file
  let aFile = files[0];
  let track = new Track(aFile);
  await track.loadFile();
  // TODO : clean-up this logic
  if (document.getElementById('buttonFileTrack').innerHTML != 'ghost!') {
    simulator.setTrack(track);
    // change button label "track!" -> "ghost!"
    document.getElementById('buttonFileTrack').innerHTML = 'ghost!';
  }
  // TODO : check if track file contains valid timing data for a ghost, that it's the same track as the main track etc
  else if (!simulator.ghost) {
    ghost = new Ghost(track);
    simulator.addGhost(ghost);
  }

}  // trackFileOnChange

function buttonRideOnClick() {
  if (buttonRide.innerHTML == "Start") {
    if (simulator.start()) {
      buttonRide.innerHTML = "Pause";
    }
  }
  else {
    if (simulator.pause()) {
      buttonRide.innerHTML = "Start";
    }
  }
} // buttonRideOnClick

function onPedalData(pedalData) {
    peanuts[0] = [...pedalData.peanut];
    // show only 1 peanut in this app
    radarCfg.data.datasets[0].data = peanuts[0];
    // autoscale in chartjs jumps from 200 to 500
    // replace with step 50
    let pedalMax = Math.max.apply(null, radarChart.data.datasets[0].data.filter(function (x) {
      return isFinite(x);
    }));
    pedalMax = pedalMax + 50 - (pedalMax % 50)
    radarCfg.options.scale.ticks.max = pedalMax
    radarChart.update();
  } // onPedalData

async function buttonConnectTrainerOnClick() {
  if (!simulator.rider.trainer.connected) {
    try {
      await simulator.rider.connectTrainer();
      // change button color
      buttonConnectTrainer.classList.add("connected");
      // 04/2023: can this cleaner?
      simulator.rider.trainer.addEventListener('pedaldata', onPedalData);
    } catch (error) {
      log('error connecting direto : ' + error);
    }
  }
  else { // disconnect
    try {
      await simulator.rider.disconnectTrainer();
      // change button color
      buttonConnectTrainer.classList.remove("connected");
      simulator.rider.trainer.removeEventListener('pedaldata', onPedalData);
    } catch (error) {
      log (`error disconnecting direto : ${error}`);
    }
  }
} // buttonConnectTrainerOnClick

async function buttonConnectHrmOnClick() {
  if (!simulator.rider.hrm.connected) {
    try {
      await simulator.rider.connectHrm();
      // change button color
      buttonConnectHrm.classList.add("connected");
    } catch (error) {
      log('error connecting hrm : ' + error);
    }
  }
  else { // disconnect
    try {
      await simulator.rider.disconnectHrm();
      // change button color
      buttonConnectHrm.classList.remove("connected");
    } catch (error) {
      log (`error disconnecting hrm : ${error}`);
    }
  }
} // buttonConnectHrmOnClick

function buttonDownloadOnClick() {
  let saveFileFormat = "gpx"; // "xml" or "gpx"
  let xml, fileName;
  if (rider.rideLog.length) {
    if (saveFileFormat == "xml") {
      xml = ridelog2ShortXML(rider.rideLog,simulator.track.trackData);
      fileName = simulator.track.trackData.routeName.replace(/ /g,"_") + '.xml';
    }
    else if (saveFileFormat == "gpx") {
      let rouvyXmlFile = new RouvyXmlFile();
      xml = rouvyXmlFile.makeGPX(rider.rideLog,simulator.track.trackData);
      fileName = simulator.track.trackData.routeName.replace(/ /g,"_") + '.gpx';
    }
    let fileContents = encodeURIComponent(xml);
    buttonDownload.href = 'data:text/plain;charset=utf-8,' + fileContents;
    buttonDownload.download = fileName;
  }
} // buttonDownloadOnClick

function doStravaUploadPoll(uploadId) {
  axios.get(`https://www.strava.com/api/v3/uploads/${uploadId}`, {
    headers : {
      'Authorization': `Bearer ${stravaAccessToken}`
    },
  })
  .then((res) => {
    if (res.status >= 200 && res.status < 300) {
      if (res.status == 200) {
        // activity is ready at https://www.strava.com/activities/${res.data.activity_id}
        clearInterval(stravaUploadPollTimer);
      }
    }
    else {
      clearInterval(stravaUploadPollTimer);
    }
  },(err) => {
    console.log(err);
    clearInterval(stravaUploadPollTimer);
  });
} // doStravaUploadPoll

function buttonUploadOnClick() {
  let saveFileFormat = "gpx"; // "xml" or "gpx"
  let xml, fileName;
  if (!rider.rideLog.length) {
    return;
  }
  if (!stravaAccessToken)
  {
    log('need accessToken before upload. Authorize first!');
    return;
  }

  let rouvyXmlFile = new RouvyXmlFile();
  xml = rouvyXmlFile.makeGPX(rider.rideLog,simulator.track.trackData);
  fileName = simulator.track.trackData.routeName.replace(/ /g,"_") + '.gpx';

  const formData = new FormData();
  var blob = new Blob([xml], {type:"text/xml"});
  //formData.append('file', xml); // werkt nie
  formData.append('file', blob);

  // post upload with axios
  let params = {
    name : "HomeTrainer !",
    description : "zweetfeest!",
    data_type : "gpx",
    external_id : `${fileName}`,
    activity_type : "virtualride"
  };
  axios.post('https://www.strava.com/api/v3/uploads', formData, {
    headers : {
      'Content-Type': 'multipart/form-data',
      'Authorization': `Bearer ${stravaAccessToken}`
    },
    params : params
  })
  .then((res) => {
    if (res.status == 201) {
      // success! Strava is processing the upload
      log(`got uploadId = ${res.data.id}, strava-status = ${ res.data.status}`);
      stravaUploadPollTimer = setInterval(doStravaUploadPoll,2000,res.data.id);
    }
  }, (err) => console.log(err));
    
} // buttonUploadOnClick

// trackData enkel nodig voor trackData.routeName en trackData.routeDescription
function ridelog2ShortXML(ridelog, trackData) {
  var doc = '<?xml version="1.0"?> \r\n <gpx>';
  
  doc += `<name>${trackData.routeName}</name>\r\n`;
  for (i = 0; i < ridelog.length; i ++) {
    point = ridelog[i];
    doc += `<pt><time>${point.time}</time>`;
    doc += `<pow>${point.power}</pow>`;
    doc += `<bpm>${point.bpm}</bpm>`;
    doc += `<cad>${point.cadence}</cad>`;
    doc += `<lat>${point.lat}</lat>`;
    doc += `<lon>${point.lon}</lon>`;
    doc += `<ele>${point.elevation}</ele></pt>\r\n`;
  }
  doc += '</gpx>';
  return doc;

} // ridelog2ShortXML

function initRidesTable() {
  let ridesTable = document.getElementById("tableTheRides");
  for (let i=0; i < theRides.length; i++) {
    let r, c;
    r = ridesTable.insertRow();
    c = r.insertCell(); c.innerHTML = theRides[i].name;
    c = r.insertCell(); c.innerHTML = theRides[i].description;
    c = r.insertCell(); c.innerHTML = `<button class= "aRideButton" id= "ride_${i}">GO!</button>`;
  }
  let aRideButtons = document.getElementsByClassName("aRideButton");
  for (let i=0; i<aRideButtons.length;i++) {
    aRideButtons[i].onclick = startRideOnClick;
  }

} // initRidesTable
async function startRideOnClick(event) {
  let rideId = parseInt(event.target.id.substr(5)); // button id= ride_%i
  // quick sanity check
  if ( isNaN(rideId) || (rideId < 0) || (rideId >= theRides.length) ) {
    return;
  }

  let track = new Track(theRides[rideId]);
  await track.loadUrl(theRides[rideId].track_url);
  simulator.setTrack(track);
  // test 11.2023
  ghost = new Ghost(track,true,240);
  simulator.addGhost(ghost);


  if (theRides[rideId].isYouTube) {
    simulator.loadVideoFromYouTubeUrl(theRides[rideId].video_url);
  }
  else {
    simulator.loadVideoFromUrl(theRides[rideId].video_url);
  }

} // startRideOnClick