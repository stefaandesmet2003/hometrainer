import requests
from PIL import Image
import matplotlib.pyplot as plt # pyplot for showing image
import time

'''
with Image.open("thumbnail_1080x720.png") as im:
    #im.show()
    plt.imshow(im)
    plt.show() # image will not be displayed without this
'''    

requests.packages.urllib3.disable_warnings()

searchtxt = ""
min_distance = 10
max_distance = 35 #km
min_vertical = 600 #m
max_vertical = 1500 #m
min_avgslope = 3

is_completed = False
offset= 0 # continue from 192
while not is_completed:
    
    print(f"requesting rouvy at {offset=}")

    url = f"https://rouvy.com/api/route/search?offset={offset}&query={searchtxt}" \
          f"&averageSlopeFrom={min_avgslope}&averageSlopeTo=100&distanceFrom={min_distance}&distanceTo={max_distance}" \
          f"&elevationFrom={min_vertical}&elevationTo={max_vertical}&supportsAugmentedReality=false"
    
    tic = time.perf_counter()
    r = requests.get(url, verify = False)
    toc = time.perf_counter()
    print (f"https request took {toc - tic:0.4f} seconds")
    
    if r.status_code == 200:
        routes = r.json()
    print(f"got {len(routes)} routes")
    for route in routes:
        infotxt = f"{route.get('name')} : {(route.get('distanceInMeters')/1000.0):0.2f}km, {route.get('elevationInMeters')}m"
        print(infotxt)
        maxVideoQuality = route.get('maxVideoQuality')
        if maxVideoQuality == 0:
            print("no video for this route - skipping")
            continue
        # de thumbnail urls werken dan ook niet, en de image.open code crasht
        thumbnail_url = route.get('videoPreview',{}).get('thumbnail')
        if thumbnail_url and 'http' in thumbnail_url:
            try:
                im = Image.open(requests.get(thumbnail_url, stream=True).raw)
                imsize = im.size #(1080,720)
            except :
                print("OOPS : thumbnail url doesn't work")
    
        geometry = route.get("geometry")
        distances = [point.get('distance') for point in geometry]
        altitudes = [point.get('altitude') for point in geometry]
        maxdistance = max(distances)
        maxaltitude = max(altitudes)
        minaltitude = min(altitudes)
        if im:
            altitudes = [imsize[1]*(maxaltitude - altitude)/(maxaltitude-minaltitude) for altitude in altitudes]
            distances = [distance*imsize[0]/maxdistance for distance in distances]
            plt.imshow(im, alpha=.7)
        plt.plot(distances,altitudes)
        plt.title(infotxt)
        #plt.text(-5, 60, 'Parabola $Y = x^2$', fontsize = 22) 
        filename = f"rouvyroutes/{route.get('id')}.png"
        plt.savefig(filename,bbox_inches='tight')
        plt.clf()
        #plt.show() # moet na het saven, anders is de figuur leeg
        
    # we krijgen telkens 6 items
    if len(routes) != 6:
        is_completed = True
    else:
        offset += 6

print(f"all done, stopped at {offset=}")    
