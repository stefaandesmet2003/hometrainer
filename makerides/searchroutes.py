'''
search routes in rouvy db based on search parameters
uts a thumbnail with description in outputdirectory for each search result (ride) 
03/2024 needs a rouvy login session now
TODO : bug when problem in creating image (previous image is used with the current route?)
'''
import requests
from PIL import Image
import matplotlib.pyplot as plt # pyplot for showing image
import time
import os

requests.packages.urllib3.disable_warnings()

outputdir = f"routes_{time.strftime('%Y%m%d',time.localtime(time.time()))}"
if not os.path.exists(outputdir):
    os.mkdir(outputdir)

###############################################################################
# search parameters
###############################################################################

max_results = 300
searchtxt = "vuelta"
searchtxt = ""
min_distance = 15000
max_distance = 35000 #m
min_vertical = 600 #m
max_vertical = 1500 #m
#min_avgslope = 3 # niet meer ondersteund
# routeTags lijkt leuk, maar de meeste rides zijn nog niet getagged
allRouteTags = [
    "the-americas", 
    "asia-pacific", 
    "europe", 
    "africa",
    "national-parks",
    "gravel",
    "iconic-courses"
    ]
# ofwel een routeTags list en dan per list item een url param routeTags=<item> in de search url
routeTags = ""
#routeTags = "asia-pacific"

###############################################################################
# do search
###############################################################################
s = requests.Session()
print("logging in ..")
tic = time.perf_counter()

login_url = "https://riders.rouvy.com/login?_data=routes%2F_auth.login"
login_data = {
    'email': 'email-address',
    'password': 'password'
    }
r = s.post(login_url,login_data,verify=False)
toc = time.perf_counter()
print (f"login took {toc - tic:0.4f} seconds")

print("launching initial search..")
tic = time.perf_counter()
data_url = "https://riders.rouvy.com/?_data=root"
r = s.get(data_url,verify=False) # geeft wat user info data - dosschesport

search_url = f"https://riders.rouvy.com/routes/search/?count=10&maxAscended={max_vertical}&maxDistance={max_distance}&minAscended={min_vertical}&minDistance={min_distance}&scenario=Search-Routes&searchQuery={searchtxt}&routeTags={routeTags}"
# search_url geeft een html page, niet ideaal
r = s.get(search_url,verify=False) # deze duurt een paar seconden
html = r.content.decode('utf-8')
# hier zitten al 6 zoekresultaten in, maar voorlopig niet gebruikt
'''
import json
j = json.loads(html.split('__remixContext = ')[1].split(';')[0])
routes = j['state']['loaderData']['routes/_main.routes.search']['routes']
'''

idx = html.find('"recommendationId":')
recommendationId = html[idx:].split('"recommendationId":')[1].split(',')[0].strip('"')
# deze recommendationId hebben we nodig voor de rest van de search
toc = time.perf_counter()
print (f"initial search took {toc - tic:0.4f} seconds, obtained recommendationId = {recommendationId}")

is_completed = False
num_results = 0
nextsearch_url = f"https://riders.rouvy.com/routes/search?next={recommendationId}&_data=routes%2F_main.routes.search"

while not is_completed:
    print(f"doing next search, {num_results=}")
    tic = time.perf_counter()
    r = s.get(nextsearch_url, verify=False)
    toc = time.perf_counter()
    print (f"https request took {toc - tic:0.4f} seconds")
    # nu hebben we json results
    routes = list()
    if r.status_code == 200:
        routes = r.json().get('nextRoutes')
        print(f"got {len(routes)} routes")

    for i,route in enumerate(routes):
        distanceMeters = route.get('distanceMeters',0.01)
        ascendedMeters = route.get('ascendedMeters',0.01)
        avgSlope = 100.0*ascendedMeters / distanceMeters
        infotxt = f"{route.get('name')} : {(distanceMeters/1000.0):0.2f}km, {ascendedMeters}vm, {avgSlope:0.1f}%"
        print(f"{num_results+i}({route.get('id')}):{route.get('name')}:{(distanceMeters/1000.0):0.2f}km, {ascendedMeters}vm, {avgSlope:0.1f}%")    
        #thumbnail_url = route.get('thumbnails',{}).get('large')
        # de large thumbnail url moet je nog recupereren, 
        # bv 'large': 'https://thumbor.rouvy.com/XbsmDF6xHlARaypzqsZ53WIplIc=/592x800/smart/https%3A%2F%2Fcdn.virtualtraining.eu%2Froutes%2F93334%2Fvideo%2Fthumbnail_1080x720.png'
        # https://cdn.virtualtraining.eu/routes/93334/video/thumbnail_1080x720.png
        thumbnail_url = route.get('thumbnails',{}).get('medium')
        if thumbnail_url and 'http' in thumbnail_url:
            try:
                im = Image.open(requests.get(thumbnail_url, stream=True).raw)
                imsize = im.size #(1080,720)
            except :
                print("OOPS : thumbnail url doesn't work")
    
        geometry = route.get("simplifiedGeometryPoints")
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
        filename = f"{outputdir}/{route.get('id')}.png"
        plt.savefig(filename,bbox_inches='tight')
        plt.clf()
        #plt.show() # moet na het saven, anders is de figuur leeg
        
    num_results+= len(routes)
    if len(routes) == 0 or num_results > max_results:
        is_completed = True

print(f"search complete, stopped at {num_results=}")
print("logging out now")

logout_url = "https://riders.rouvy.com/logout?_data=routes%2F_auth.logout"
s.post(logout_url)
s.close()
print("logout done")

###############################################################################
# for info
###############################################################################
'''
with Image.open("thumbnail_1080x720.png") as im:
    #im.show()
    plt.imshow(im)
    plt.show() # image will not be displayed without this
'''    
'''
nextsearch_url = f"https://riders.rouvy.com/routes/search?next={recommendationId}&_data=routes%2F_main.routes.search"
r = s.get(nextsearch_url)
# nu hebben we json results
routes = r.json().get('nextRoutes')
print(f"got {len(routes)} routes")
for i,route in enumerate(routes):
    print(f"{i}({route.get('id')}):{route.get('name')}:{route.get('distanceMeters')}m long, {route.get('ascendedMeters')}vm")

prevsearch_url = f"https://riders.rouvy.com/routes/search?prev={recommendationId}&_data=routes%2F_main.routes.search"
r = s.get(prevsearch_url)
routes= r.json().get('routes')
print(f"got {len(routes)} routes")
for i,route in enumerate(routes):
    print(f"{i}({route.get('id')}):{route.get('name')}:{route.get('distanceMeters')}m long, {route.get('ascendedMeters')}vm")
'''
