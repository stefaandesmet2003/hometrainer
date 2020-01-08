#!/usr/bin/env python3

# hiervoor moet wel lxml via pip3 geinstalleeerd worden
# in spyder of in een terminal met conda geactiveerd, is lxml aanwezig
# maar niet vanuit file manager!


from lxml import etree
from datetime import datetime
import os
import glob
import requests
import time
import json
import pickle

#strava upload stuff

def store_strava_tokens_as_pickle(strava_tokens,strava_client):
    f = open("mystravatokens.bin", "wb")
    pickle.dump(strava_tokens,f)
    pickle.dump(strava_client,f)
    f.close()

def load_strava_tokens():
    f = open("mystravatokens.bin", "rb")
    mytokens = pickle.load(f)
    myclient = pickle.load(f)
    f.close()
    # check if access token expired
    expires_at = mytokens["expires_at"]
    print (f"stored access token expires at {time.ctime(expires_at)} : ", end='')
    if time.time() > mytokens["expires_at"] :
        print (f"expired!\nRefreshing token now!")
    
        url = "https://www.strava.com/api/v3/oauth/token"
        params = {"client_id" : myclient['clientID'],
                  "client_secret" : myclient['clientSecret'],
                  "grant_type" : "refresh_token",
                  "refresh_token" : mytokens['refresh_token']}
        r = requests.post(url, params=params)
        
        print (f"strava request returned with status {r.status_code}!")
        if r.status_code >= 200 and r.status_code < 300: # klopta die return code, of is het 201 of zo??
            # store new token!
            mytokens = json.loads(r.text)
            store_strava_tokens_as_pickle(mytokens,myclient)
            print ("new tokens stored!")
        else:
            # mytokens hasn't changed but access token has expired and refresh failed..
            print("token refresh failed")
            pass
    else:
        print ("OK (not expired)!")
        
    return (mytokens,myclient)

def get_strava_data_type (filename):
    dtype = os.path.splitext(filename)[1][1:]
    return dtype

def do_strava_file_upload (filename, accessToken):
    fp = open (filename, 'rb')
    #start the upload
    url = "https://www.strava.com/api/v3/uploads"
    params = {"name" : f"HomeTrainer ! {os.path.splitext(filename)[0]}",
              "description" : "zweetfeest!",
              "data_type" : f"{get_strava_data_type(filename)}",
              "external_id" : f"{filename}",
              "activity_type" : "virtualride"}
    files = {'file': fp}
    headers = {'Authorization': f"Bearer {accessToken}"}
    r = requests.post(url, params=params, headers=headers, files=files)
    print (f"strava request returned with status {r.status_code}!")
    fp.close()

    if r.status_code < 200 or r.status_code >= 300: #only 200 or 201 ('created') are ok in fact
        print(f"upload failed : strava said : {r.text}")
        return
    
    rjson = json.loads(r.text)
    print (f"upload status : {rjson['status']}")
    if rjson['error'] != None:
        print (f"strava returned an error : {rjson['error']}")
    upload_id = rjson['id'] # met de upload_id kunnen we checken of de activity klaar is op strava.com
    start_poll_time = time.time()
    while rjson['activity_id'] == None and rjson['error'] == None and time.time() < start_poll_time + 15:
        #continue polling for 15 seconds
        time.sleep(1.0)
        
        # poll strava for update
        url = f"https://www.strava.com/api/v3/uploads/{upload_id}"
        r = requests.get(url, headers=headers)
        print (f"{time.ctime(time.time())} : strava request returned with status {r.status_code}!")
        if r.status_code == 200:
            rjson = json.loads(r.text)
            if rjson['error'] != None:
                print (f"strava returned an error : {rjson['error']}")
        else:
            print ("polling strava failed, check again later !")
            break
    
    if rjson["activity_id"] != None:
        # activity is ready!
        print (f"activity ready at : https://www.strava.com/activities/{rjson['activity_id']}")
            
    return


#load strava oauth tokens
strava_tokens, strava_client = load_strava_tokens()

# gewoon alle local .xml files omzetten
xmlfiles = glob.glob("*.xml")

for xmlfile in xmlfiles:
    gpxfilename = os.path.splitext(xmlfile)[0] + '.gpx'
    print (f"converting {xmlfile} to {gpxfilename}!")
    
    xmldoc = etree.parse(xmlfile)
    points = xmldoc.xpath("//pt")
    
    gpxstr = '''<gpx xmlns="http://www.topografix.com/GPX/1/1" version="1.1" creator="KinomapVirtualRide" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd http://www.garmin.com/xmlschemas/GpxExtensions/v3 http://www.garmin.com/xmlschemas/GpxExtensionsv3.xsd http://www.garmin.com/xmlschemas/TrackPointExtension/v1 http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd" xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1" xmlns:gpxx="http://www.garmin.com/xmlschemas/GpxExtensions/v3" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
            <metadata>
                <time>FILL-IN-STARTTIME</time>
            </metadata>
            <trk>
                <name>Trackname</name>
                <desc>Description</desc>
                <trkseg></trkseg>
            </trk>
        </gpx>'''
    
    #zonder deze parser werkt pretty_print niet correct op het einde
    # zie : https://lxml.de/FAQ.html#why-doesn-t-the-pretty-print-option-reformat-my-xml-output
        
    parser = etree.XMLParser(remove_blank_text=True)
    gpxdoc = etree.ElementTree(etree.fromstring(gpxstr,parser=parser))
    
    # xpath en namespaces -> opzoeken want het werkt nie!
    #gpxdoc.xpath("{http://www.topografix.com/GPX/1/1}//trk")
    #gpxdoc.xpath("//trk",namespaces = {None:'http://www.topografix.com/GPX/1/1'})
    #find() en findall() werken wel
    #t_el = gpxdoc.findall("//{http://www.topografix.com/GPX/1/1}metadata/{http://www.topografix.com/GPX/1/1}time")
    # handiger is om 1x de namespace mee te geven als 2de parameter in find(,NS) of findall (,NS)
    NS = {None:'http://www.topografix.com/GPX/1/1'}
    gpx_meta_time = gpxdoc.find("//metadata/time",NS)
    ts = int(points[0].xpath("//time")[0].text)
    #uit javascript komt timestamp in milliseconds, bij datetime(timestamps) is timestamp in (float) seconds
    gpx_meta_time.text = datetime.fromtimestamp(ts/1000).astimezone().isoformat()
    
    #find() is voldoende, we hebben toch maar 1 find
    gpxdoc.find("//trk/name",NS).text = xmldoc.find("//name").text
    #gpxdoc.find("//trk/desc",NS).text = "empty"
    
    trkseg = gpxdoc.find("//trkseg",NS)
    for point in points:
        eletxt = point.find("ele").text #ele is een string -> float(ele) is een float
        eletxt = f"{float(eletxt):.2f}" #een string met 2 decimals van ele
        ts = int(point.find("time").text)
        timetxt = datetime.fromtimestamp(ts/1000).astimezone().isoformat()
        #timetxt is bv: '2019-12-11T09:59:25.121000+01:00'
        #de +01:00 is conform met Z == local time (vgl javascript Date.toISOString())
        lattxt = point.find("lat").text 
        lontxt = point.find("lon").text
        cadtxt = point.find("cad").text
        
        trkpt = etree.SubElement(trkseg,"{http://www.topografix.com/GPX/1/1}trkpt")
        trkpt.set("lat",lattxt)
        trkpt.set("lon",lontxt)
        timestamp = etree.SubElement(trkpt,"{http://www.topografix.com/GPX/1/1}time")
        timestamp.text = timetxt
        ele = etree.SubElement(trkpt,"{http://www.topografix.com/GPX/1/1}ele")
        ele.text = eletxt
        extensions = etree.SubElement(trkpt,"{http://www.topografix.com/GPX/1/1}extensions")
        power = etree.SubElement(extensions,"{http://www.topografix.com/GPX/1/1}power")
        power.text = point.find("pow").text
        #cadence in the gpxtpx extension
        gpxtpx_ns = gpxdoc.getroot().nsmap['gpxtpx']
        gpxtpx_trackpoint_extension = etree.SubElement(extensions,f"{{{gpxtpx_ns}}}TrackPointExtension")
        gpxtpx_cad = etree.SubElement(gpxtpx_trackpoint_extension,f"{{{gpxtpx_ns}}}cad")
        gpxtpx_cad.text = cadtxt
        
    gpxdoc.write(gpxfilename,encoding='utf-8', pretty_print=True, xml_declaration=True)
    print(f"done writing {gpxfilename}!")

    #upload to strava
    do_strava_file_upload(gpxfilename,strava_tokens['access_token'])
    
print("all done!")