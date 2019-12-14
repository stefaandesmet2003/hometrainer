#!/usr/bin/env python3

# hiervoor moet wel lxml via pip3 geinstalleeerd worden
# in spyder of in een terminal met conda geactiveerd, is lxml aanwezig
# maar niet vanuit file manager!


from lxml import etree
from datetime import datetime
import os
import glob

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
                <name>GPX Trackname</name>
                <desc>GPX Track Description</desc>
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
    gpxdoc.find("//trk/desc",NS).text = "empty"
    
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
        time = etree.SubElement(trkpt,"{http://www.topografix.com/GPX/1/1}time")
        time.text = timetxt
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
    
print("all done!")