# city-roads

Render every single road in any city at once: https://anvaka.github.io/city-roads/

![demo](https://i.imgur.com/6bFhX3e.png)

## How it is made?

The data is fetched from OpenStreetMap using [overpass API](http://overpass-turbo.eu/). While that API
is free (as long as you follow ODbL licenses), it can be rate-limited and sometimes it is slow. After all
we are downloading thousands of roads within an area!

To improve the performance of download, I indexed ~3,000 cities with population larger than 100,000 people and
stored into a [very simple](https://github.com/anvaka/index-large-cities/blob/master/proto/place.proto) protobuf format. The cities are stored into a cache in this github [repository](https://github.com/anvaka/index-large-cities).

The name resolution is done by [nominatim](https://nominatim.openstreetmap.org/) - for any query that you type
into the search box it returns list of area ids. I check for the area id in my list of cached cities first,
and fallback to overpass if area is not present in cache.

## Scripting

Behind simple UI software engineers would also find scripting capabilities. You can develop programs on top
of the city-roads. A few examples are available in [city-script](https://github.com/anvaka/city-script). Scene
API is documented here: https://github.com/anvaka/city-roads/blob/main/API.md

Please share your creations and do not hesitate to reach out if you have any questions.

## Limitations

The rendering of the city is limited by the browser and video card memory capacity. I was able to render Seattle
roads without a hiccup on a very old samsung phone, though when I tried Tokyo (with 1.4m segments) the phone
was very slow.

Selecting area that has millions of roads (e.g. a Washington state) may cause the page to crash even on a
powerful device.

Luckily, most of the cities can be rendered without problems, resulting in a beautiful art.

## Support

If you like this work and want to use it in your projects - you are more than welcome to do so!

Please [let me](https://twitter.com/anvaka) know how it goes. You can also sponsor my projects [here](https://github.com/sponsors/anvaka) - your funds will be dedicated to more awesome and free data visualizations.

## Local development

``` bash
# install dependencies
npm install

# serve with hot reload at localhost:8080
npm run dev

# build for production with minification
npm run build

# build for production and view the bundle analyzer report
npm run build --report
```

## Persisting overlays across devices

The app can persist map overlays (radius/line shapes and view box) in a backend database,
so you don't need to share long URLs.

Run the backend API in one terminal:

```bash
npm run server
```

Run the frontend in another terminal:

```bash
npm run dev
```

In development, Vite proxies `/api/*` to `http://localhost:8081`.
The backend stores map state records in `server/data/map-state.db`.

## Docker deployment

Run with Docker Compose (published on host port `2937`):

```bash
docker compose up -d --build
```

Then open:

```text
http://localhost:2937
```

Stop it with:

```bash
docker compose down
```

Without Compose:

```bash
docker build -t city-roads:latest .
docker run -d --name city-roads -p 2937:8080 -v city-roads-data:/data city-roads:latest
```

## License

The source code is licensed under MIT license
