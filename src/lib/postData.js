import request from './request.js';
import Progress from './Progress.js';

let backends = [
  'https://overpass-api.de/api/interpreter',
  'https://maps.mail.ru/osm/tools/overpass/api/interpreter',
  'https://overpass.osm.jp/api/interpreter',
  'https://overpass.kumi.systems/api/interpreter',
  'https://overpass.openstreetmap.ru/cgi/interpreter',
  'https://overpass.nchc.org.tw/api/interpreter'
]

export default function postData(data, progress) {
  progress = progress || new Progress();
  const postData = {
    method: 'POST',
    responseType: 'json',
    progress,
    headers: {
      'Content-type': 'application/x-www-form-urlencoded; charset=UTF-8'
    },
    body: 'data=' + encodeURIComponent(data),
  };

  let serverIndex = 0;

  return fetchFrom(backends[serverIndex]);

  function fetchFrom(overpassUrl) {
    return request(overpassUrl, postData, 'POST')
      .catch(handleError);
  }

  function handleError(err) {
    if (err.cancelled) throw err;

    if (serverIndex >= backends.length - 1) {
      // we can't do much anymore - all servers failed
      err.allServersFailed = true;
      err.serversAttempted = backends.length;
      throw err;
    }

    if (err.statusError) {
      progress.notify({
        loaded: -1
      });
    }

    serverIndex += 1;
    return waitForRetry(err)
      .then(() => fetchFrom(backends[serverIndex]))
  }
}

function waitForRetry(err) {
  if (err && err.statusError === 429) return delay(7000);
  if (err && err.statusError === 504) return delay(4000);
  return delay(1000);
}

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}