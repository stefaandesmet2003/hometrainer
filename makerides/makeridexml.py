'''
downloads route data from rouvy 
turns AR routes in a usable xml for hometrainer
for non-AR routes the xml is available online
creates the rides.json for hometrainer (appended after each run of make_all_rides())
tmp dir contains the html & unzipped json data (AR only)

'''
import json
import requests
import gzip
import math  # for the vincenty formula
import os  # files

requests.packages.urllib3.disable_warnings()

ridesjsonfilename = 'rides.json'
rideids = [2675,22010,4476,32590,7702,27104,3260,94893,73764,78423,77234,24248,56662]
rideids.extend([56017,55278,55326,83517,22988,7169,70161,70231])
rideids.extend([77756,84408,86987,87659,87667,92452,77109, 81488, 83294, 31652, 95912, 95373, 79357, 78811, 78396, 78185, 93829, 92431,
            95266, 94237, 89633, 74256])

rideids.extend([93411,95921])
rideids.extend([22010,39329,56323,60781,70870,76585,77123,80714]) # 28/02/2024
rideids.extend([95595,39739,56662,71931,82946,63180,38017,62763,42462,78806,75494,92123,70333,57002]) # 09/03/2024


# end of list rides
rideids.extend([56888,19636,21958,18278,4480,1433,1627,1430,4142,4316,4477,3338,7214,19357,13915])

# uninteresting rides / bad video 41876
# 

##############################################################################################
# HELPER VINCENTY FORMULA
##############################################################################################
def toRad(value):
    # Converts numeric degrees to radians
    return value * math.pi / 180

# returns distance in meters between points
def distVincenty(lat1, lon1, lat2, lon2):
    a, b, f = 6378137, 6356752.314245, 1 / 298.257223563  # WGS-84 ellipsoid params
    L = toRad(lon2 - lon1)
    U1 = math.atan((1 - f) * math.tan(toRad(lat1)))
    U2 = math.atan((1 - f) * math.tan(toRad(lat2)))
    sinU1, cosU1 = math.sin(U1), math.cos(U1)
    sinU2, cosU2 = math.sin(U2), math.cos(U2)

    _lambda = L
    iterLimit = 100
    while True:
        sinLambda, cosLambda = math.sin(_lambda), math.cos(_lambda)
        sinSigma = math.sqrt((cosU2 * sinLambda) * (cosU2 * sinLambda) +
                             (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda) * (cosU1 * sinU2 - sinU1 * cosU2 * cosLambda))
        if sinSigma == 0:
            return 0  # co-incident points
        cosSigma = sinU1 * sinU2 + cosU1 * cosU2 * cosLambda
        sigma = math.atan2(sinSigma, cosSigma)
        sinAlpha = cosU1 * cosU2 * sinLambda / sinSigma
        cosSqAlpha = 1 - sinAlpha * sinAlpha
        if cosSqAlpha > 1e-10:
            cos2SigmaM = cosSigma - 2 * sinU1 * sinU2 / cosSqAlpha
        else:
            cos2SigmaM = 0  # equatorial line: cosSqAlpha=0 (§6)
        C = f / 16 * cosSqAlpha * (4 + f * (4 - 3 * cosSqAlpha))
        lambdaP = _lambda
        _lambda = L + (1 - C) * f * sinAlpha * (
                    sigma + C * sinSigma * (cos2SigmaM + C * cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM)))
        iterLimit -= 1

        if not (abs(_lambda - lambdaP) > 1e-12 and iterLimit > 0):
            break

    if iterLimit == 0:
        return None  # formula failed to converge

    uSq = cosSqAlpha * (a * a - b * b) / (b * b)
    A = 1 + uSq / 16384 * (4096 + uSq * (-768 + uSq * (320 - 175 * uSq)))
    B = uSq / 1024 * (256 + uSq * (-128 + uSq * (74 - 47 * uSq)))
    deltaSigma = B * sinSigma * (cos2SigmaM + B / 4 * (cosSigma * (-1 + 2 * cos2SigmaM * cos2SigmaM) -
                                                       B / 6 * cos2SigmaM * (-3 + 4 * sinSigma * sinSigma) * (
                                                                   -3 + 4 * cos2SigmaM * cos2SigmaM)))
    s = b * A * (sigma - deltaSigma)

    # s = s.toFixed(3); // round to 1mm precision
    s = round(s * 1000) / 1000  # round to 1mm precision
    return s

##############################################################################################
'''
https://cdn.virtualtraining.eu/routes/94297/ar/94297
https://mediacdn.rouvy.com/routes/94297/video/94297_540_ar.mp4
-> dan krijg je een zipfile met de routedata
de afstanden lijken niet overeen te komen
(max was 11400, en route was 13k)
de url hierboven geeft in de html de volledige geometry van de route (gps+hoogte, maar geen timing)
distance in miles, altitude in feet ..
'''

'''
creates <rideid>.html & ar<rideid>.json
'''
def download_rouvy_data(rideid):
    # 1. de html met de geometry points, werkt ook voor non-AR routes
    print(f"retrieving {rideid}.html")
    routefilename = f"tmp/{rideid}.html"
    url = f"https://my.rouvy.com/virtual-routes/detail/{rideid}"
    if os.path.exists(routefilename):
        print(f"{routefilename} exists, skipping download {url}!")
    else:
        r = requests.get(url, verify=False)
        if r.status_code == 200:
            with open(routefilename, "wb") as f:
                f.write(r.content)
    # 2. de ar zip file (enkel AR-routes)
    # als je dit in browser doet krijg je een .zip file, maar is blijkbaar gz
    print(f"retrieving ar{rideid}.json")
    arjsonfilename = f'tmp/ar{rideid}.json'
    # of de arfileurl zoeken in routes.route (in de html), zie get_route_info
    url = f'https://cdn.virtualtraining.eu/routes/{rideid}/ar/{rideid}'
    if os.path.exists(arjsonfilename):
        print(f"{arjsonfilename} exists, skipping download {url}!")
    else:
        r = requests.get(url, verify=False)
        if r.status_code == 200:
            with open(arjsonfilename, 'wb') as fjson:
                fjson.write(gzip.decompress(r.content))
        else:
            print(f"{rideid} is not an AR route, ar url didn't respond!")
    print(f"download_rouvy_data({rideid}) done!")


# reads <rideid>.html and returns {}
def get_route_info(rideid):
    routefilename = f"tmp/{rideid}.html"
    if not os.path.exists(routefilename):
        return None

    with open(routefilename, 'r', encoding='utf8') as f:
        html = f.read()

    rj = json.loads(html.split('routes.route =')[1].split(';')[0])
    routename = rj.get('name')
    description = rj.get('description')  # not always filled in
    creationdate = rj.get('created', {}).get('date', '2000-01-01 12:00:00.000000').split('.')[0]
    routelength = rj.get('length')
    ascent = rj.get('upclimb')
    arfileurl = rj.get('arfileurl')
    is_ar = arfileurl is not None and 'http' in arfileurl
    videoset = rj.get('videoset')
    video_url_sq, video_url_lq = None, None
    print(f"{videoset=}")
    if videoset:
        for video in videoset:
            if video.get('quality') == 720 and video.get('isoflow') is False:
                video_url_sq = video.get('url')
            if video.get('quality') == 540 and video.get('isoflow') is False:
                video_url_lq = video.get('url')
    if video_url_sq:
        video_url = video_url_sq
    elif video_url_lq:
        video_url = video_url_lq
    else:
        print(f"WARNING : no video url found in {videoset=}")
        video_url = f"https://mediacdn.rouvy.com/routes/{rideid}/video/{rideid}_720.mp4"

    print(f"route info : {routename}:{description}, created : {creationdate}, AR={is_ar}")
    print(f"route length : {routelength}m, vertical ascent : {ascent}m")
    print(f"using {video_url=}")
    '''
    geometry entry : 
    {'latitude': 43.05701688204,
     'longitude': -6.09000775594,
     'distance': 26.65,
     'altitude': 5571.88,
     'slope': 3.25}'
    '''
    trackinfo_totaldistance = None
    trackpoints = rj.get('geometry')
    if trackpoints:
        print(f"found {len(trackpoints)} track geometry data points")
        trackinfo_totaldistance = trackpoints[-1]['distance'] * 1609.34  # in m
        print(f"track info total distance : {trackinfo_totaldistance / 1000.0:0.2f} km")
        # gps total distance
        gps_totaldistance = 0  # in m
        for i in range(1, len(trackpoints)):
            lat1 = trackpoints[i]['latitude']
            lon1 = trackpoints[i]['longitude']
            lat2 = trackpoints[i - 1]['latitude']
            lon2 = trackpoints[i - 1]['longitude']
            gps_distance = distVincenty(lat1, lon1, lat2, lon2)
            gps_totaldistance += gps_distance
        print(f"track gps total distance : {gps_totaldistance / 1000.0:0.2f} km")

    if is_ar:
        track_url = f"http://localhost:3000/rides/{rideid}.xml"
    else:
        track_url = f"https://cdn.virtualtraining.eu/routes/{rideid}/track.xml"
    ride = {'name': routename,
            'description': description,
            'creation_date': creationdate,
            'distance': trackinfo_totaldistance or routelength,
            'ascent': ascent,
            # 'video_url' : f"https://mediacdn.rouvy.com/routes/{rideid}/video/{rideid}_720.mp4",
            'video_url': video_url,
            'track_url': track_url,
            'trackpoints': trackpoints,
            'ar': is_ar,
            }
    return ride

def make_ar_track_xml(rideid):
    # use the ar file for creating the video points
    ride = get_route_info(rideid)
    # TODO : check file exists
    # TODO : handle non-AR route
    with open(f'tmp/ar{rideid}.json', 'r') as fjson:
        route = json.load(fjson)
    campos = route['Route']['CameraPositions']
    print(f"video length = {len(campos) / 30.0:.02f} seconds")  # assuming 30fps, maybe should check this in the html

    x = [campo['x'] for campo in campos]
    # y = [campo['y'] for campo in campos]
    z = [-campo['z'] for campo in campos]

    def calcdist(x1, y1, x2, y2):
        dist = math.sqrt((x1 - x2) ** 2 + (y1 - y2) ** 2)
        return dist

    # x,z zijn de positie
    xz_totaldistance = 0
    xzdistances = [0]
    for i in range(1, len(x)):
        xz_distance = calcdist(x[i], z[i], x[i - 1], z[i - 1])
        xz_totaldistance += xz_distance
        xzdistances.append(xz_totaldistance)
    print(f"xz total distance = {xz_totaldistance:0.2f}")  # dat is niet echt miles maar redelijk close
    # we gaan dat gebruiken voor een scaling  (ofwel met trackinfo_totaldistance)
    xzfactor = ride['distance'] / xz_totaldistance
    # scale
    xzdistances = [xzdistance * xzfactor for xzdistance in xzdistances]

    # write rouvy xml
    rouvyfilename = f"ridexml/{rideid}.xml"
    print(f"creating file {rouvyfilename}")
    xmlheader = f"""<?xml version="1.0" encoding="utf-8"?>
    <Track xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"> 
       <CheckValue>blabla</CheckValue>  
       <Name>{rideid}_{ride['name']}</Name>  
       <Description>{ride['description']}</Description>  
       <Date>{ride['creation_date']}</Date>  
       <Action>CYCLO_ROAD</Action> 
       <Difficulty>NOT_SPECIFIED</Difficulty> 
       <Video>xx.mp4</Video>  
    """
    with open(rouvyfilename, 'w') as f:
        f.write(xmlheader)
        # altitude points
        f.write("<AltitudePoints>\n")
        for trackpoint in ride['trackpoints']:
            distance = trackpoint.get('distance') * 1609.34  # miles to m
            alt = trackpoint.get('altitude') * 0.3048  # feet to m
            lat = trackpoint.get('latitude')
            lon = trackpoint.get('longitude')
            f.write(f'  <AltitudePoint Distance="{distance:.02f}" Lat="{lat:.6f}" Lng="{lon:.6f}" Alt="{alt:.2f}"/>\n')
        f.write("</AltitudePoints>\n")

        # video points    
        f.write("<VideoPoints>\n")
        for i in range(0, len(x), 30 * 30):
            f.write(f'  <VideoPoint Distance="{xzdistances[i]:.02f}" VideoTime="{int(i / 30)}"/>\n')
        f.write(f'  <VideoPoint Distance="{xzdistances[-1]:.02f}" VideoTime="{int(len(x) / 30.0)}"/>\n')
        f.write("</VideoPoints>\n")

        f.write('</Track>\n')

    print(f"make_ar_track_xml ({rideid}) done!")
    return ride


def make_all_rides():
    rides = []
    print(f"opening {ridesjsonfilename}")
    if os.path.exists(ridesjsonfilename):
        with open(ridesjsonfilename, 'r') as fjson:
            rides = json.load(fjson)
    print(f"found {len(rides)} rides")
    
    for rideid in rideids:
        if rideid in [ride.get('id') for ride in rides]:
            print(f'{rideid} is already present in rides.json, skipping..')
            continue
        print(f"handling route {rideid}")
        download_rouvy_data(rideid)
        arfilename = f"tmp/ar{rideid}.json"
        if os.path.exists(arfilename):
            make_ar_track_xml(rideid)
        # rides.json
        # todo check if file exists
        ri = get_route_info(rideid)
        if not ri:
            print(f"hmm route_info {rideid}.html file not downloaded, stuck here ..")
        if ri:
            # print(ri)
            description = ""
            if ri['description']:
                description += ri['description'] + ","
            description += f" {ri['distance'] / 1000.0:0.2f} km, {ri['ascent']} vm ({100.0*ri['ascent'] / (ri['distance']+0.01):0.02f}% avg)"
            ride = {
                'id' : rideid,
                'name': ri['name'],
                'description': description,
                'video_url': ri['video_url'],
                'track_url': ri['track_url'],
            }
            rides.append(ride)
        print("********************************************************************")

    print(f"updating {ridesjsonfilename}")
    with open(ridesjsonfilename, 'w') as fjson:
        json.dump(rides, fjson, indent=2)
    print('all done!')


# make_all_rides()
print('for updating rides.json call make_all_rides()')

##############################################################################################

'''
#duur = 1.01.45, komt overeen met 111059 camera positions ( 3702s @ 30fps)
campos = route['Route']['CameraPositions']
orientation = None
for i,campo in enumerate(campos):
    if i < len(campos) -1 :
        nextcampo = campos[i+1]
    else:
        nextcampo = campo
    if nextcampo['y'] > campo['y']:
        nextorientation = 'UP'
    else:
        nextorientation = 'DOWN'
    if nextorientation != orientation:
        orientation = nextorientation
        print(f"{int(i/30.0)}:{nextorientation} : {campo['y']}")

x = [campo['x'] for campo in campos]        
y = [campo['y'] for campo in campos]        
z = [-campo['z'] for campo in campos]        
i = list(range(len(x)))

# het lijkt erop dat y de hoogte is (de plot is tijd vs hoogte, niet afstand vs hoogte!)

# en de z,x plot komt sterk overeen met de kaart
import matplotlib.pyplot as plt
# plot
fig, ax = plt.subplots(1,2)

ax[0].plot(i,y) # hoogteprofiel
ax[0].set_title('hoogteprofiel')
ax[1].plot(z, x, linewidth=2.0, label='xz') # kaart +-
ax[1].set_title('kaart')
#ax.plot(x, y, linewidth=2.0, label='xy')
#ax.plot(y, z, linewidth=2.0, label='yz')

# Combine all the operations and display 
plt.show() 
'''
